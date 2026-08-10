# SEO Watcher Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

El SEO Watcher Agent es un analista SEO automatizado. Su unico trabajo es
observar el rendimiento organico de Zentry/Tukandado (impresiones, clics,
CTR, posicion) y traducir esos datos en propuestas de accion claras,
priorizadas y con evidencia. No es un ejecutor: es un vigilante que informa
al equipo humano (y, mas adelante, al Agente Director) de donde hay
oportunidad de mejora.

## 2. Objetivo

Detectar automaticamente oportunidades SEO para Zentry/Tukandado, por ejemplo:

- Keywords con impresiones y posicion entre 8 y 30 (quick wins: cerca de
  primera pagina pero sin llegar).
- Keywords que no estan en primera pagina y necesitan una apuesta de
  contenido mas fuerte (landing/articulo dedicado).
- Paginas con CTR bajo respecto a su volumen de impresiones (el listing
  aparece pero no genera clics).
- Paginas que bajan de posicion respecto al periodo anterior (posible
  problema tecnico, de contenido o de competencia).
- Oportunidades de crear o mejorar landings/articulos y enlazado interno.

### Ejemplo de logica

Si "cerraduras inteligentes para taquillas" esta en posicion 18,6 con
impresiones suficientes, el agente crea una tarea del tipo:

> "Subir keyword 'cerraduras inteligentes para taquillas' de posicion 18,6 a
> top 10", con una propuesta de acciones concretas (on-page, enlazado
> interno, meta title/description).

## 3. Metricas que vigila

Por cada combinacion `query` (keyword) + `page` (URL), el agente observa:

- `impressions` — impresiones en resultados de busqueda.
- `clicks` — clics recibidos.
- `ctr` — click-through rate (clicks / impressions).
- `position` — posicion media en resultados.
- `query` — la keyword de busqueda.
- `page` — la URL que posiciona para esa keyword.
- `previousPosition` (cuando esta disponible) — posicion del periodo
  anterior, usada para detectar caidas.

## 4. Reglas (no negociables)

- **Solo lectura.** El agente unicamente lee datos de rendimiento SEO
  (hoy: un fichero local de ejemplo; manana: Google Search Console en modo
  lectura). Nunca escribe ni modifica esos datos de origen.
- **Solo propone.** Su unico output es texto y filas en
  `data/jobs.jsonl` (tareas propuestas). No ejecuta ninguna accion sobre
  sistemas externos.
- **No modifica produccion**, en ningun caso ni bajo ninguna circunstancia.
- **No toca WordPress.** No usa credenciales de WordPress. No llama a la
  REST API de WordPress. No instala ni activa plugins.
- **No toca Google Ads.** No crea, edita ni pausa campanas, grupos de
  anuncios, keywords ni presupuestos.
- **No toca GA4/GTM.** No crea eventos, tags, triggers ni versiones de
  contenedor.
- **No toca n8n.** No crea, edita ni ejecuta workflows.
- **No publica nada.** Ni en el sitio web, ni en redes, ni en ningun canal.
- **No usa mutate endpoints** de ninguna API externa (solo lectura/consulta).
- **No maneja ni imprime secretos.** No lee ni imprime ficheros `.env`
  completos. No guarda tokens, claves ni contrasenas en los logs.
- **Toda accion real requiere aprobacion humana explicita** antes de
  ejecutarse, sin excepcion (ver `docs/approval-policy.md`).

## 5. Criterios para crear una tarea (job)

El agente genera una tarea propuesta cuando una fila de datos cumple alguno
de estos criterios (parametros exactos en `config/thresholds.json`):

| Tipo de oportunidad   | Condicion |
|---|---|
| `quick_win`            | Posicion entre `opportunityMinPosition` (8) y `opportunityMaxPosition` (30), con impresiones >= `opportunityMinImpressions` (20). |
| `low_ctr`               | CTR < `lowCtrThreshold` (1%), con impresiones suficientes. Aplica incluso si la posicion ya es buena (el listing aparece pero no convence). |
| `position_drop`         | La posicion actual empeora respecto a la anterior en >= `positionDropAlertDelta` (5 puestos). Prioridad siempre alta: es una regresion. |
| `future_opportunity`    | Posicion > `futureOpportunityMinPosition` (30), con impresiones suficientes. Se marca explicitamente como "oportunidad futura / requiere landing fuerte", **no** como quick win: exige contenido nuevo, no solo retoques. |

Ademas, para decidir la prioridad de cada tarea el agente cruza la keyword
con `config/seo-target-keywords.json` (lista de keywords comerciales
prioritarias para el negocio) y con el tipo de oportunidad detectado.

## 6. Formato de salida

Cada oportunidad detectada se registra como un job en `data/jobs.jsonl` y se
resume en consola/log con estos campos:

- **Oportunidad detectada** (tipo: `quick_win` / `low_ctr` / `position_drop` / `future_opportunity`)
- **Keyword**
- **URL** (page)
- **Posicion actual**
- **Objetivo** (posicion objetivo)
- **Accion recomendada** (texto especifico y accionable)
- **Prioridad** (`high` / `medium` / `low`)
- **Riesgo** (`low` / `medium` — riesgo de implementar la accion recomendada, no del agente en si, que nunca ejecuta nada)
- **Requiere aprobacion** (siempre `true` en el estado actual del proyecto)
- **Siguiente revision** (fecha, hoy + `reviewCycleDays`)

## 7. Como evoluciona

El agente soporta dos fuentes de datos intercambiables, elegidas con la
variable de entorno `SEO_DATA_SOURCE` (ver `src/adapters/index.ts`):

- `mock` (por defecto) — `data/sample-search-console-data.json` via
  `src/adapters/search-console-placeholder.ts`. Sin credenciales.
- `search_console` — API real de Google Search Console, solo lectura
  (`searchanalytics.query`), via `src/adapters/search-console.ts`. Requiere
  credenciales `GSC_*` (ver `.env.example`).

En ambos casos la logica de analisis (`src/agents/seo-watcher.ts`) es
identica y las reglas de la seccion 4 se mantienen intactas — el adaptador
real no anade ninguna llamada de escritura. Limitacion conocida: la API de
Search Console no devuelve un "periodo anterior" en la misma consulta, asi
que las oportunidades `position_drop` no se generan todavia con datos
reales (si con datos mock, que si incluyen `previousPosition`).
