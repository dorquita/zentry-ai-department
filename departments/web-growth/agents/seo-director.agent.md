# SEO Director Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

El SEO Director Agent es un sintetizador de prioridades. No analiza datos
de Search Console (eso ya lo hace el [SEO Watcher Agent](seo-watcher.agent.md)):
lee lo que el SEO Watcher ya detecto y lo convierte en un plan de accion
claro y accionable para una persona (Pau), en vez de una lista plana de
oportunidades sueltas.

## 2. Objetivo

Leer el ultimo informe generado por el SEO Watcher (`reports/seo/`) y las
tareas mas recientes de `data/jobs.jsonl`, agrupar las oportunidades por
keyword + pagina, y producir un plan de accion priorizado: que tocar
primero, por que, con que esfuerzo y que impacto se espera.

## 3. Entradas (solo lectura)

- `reports/seo/*.md` — informes ya generados por el SEO Watcher.
- `data/jobs.jsonl` — tareas propuestas ya generadas por el SEO Watcher
  (se usan las de la ejecucion mas reciente, identificada por `meta.runId`).

Este agente **no** llama a ninguna API externa y **no** necesita
credenciales ni variables de entorno: todo lo que usa ya existe en disco,
escrito por el SEO Watcher.

## 4. Reglas (no negociables)

- **Solo lectura.** Unicamente lee `reports/seo/` y `data/jobs.jsonl`.
  Nunca modifica esos ficheros de origen.
- **Solo propone.** Su unico output es un informe nuevo en
  `reports/seo-director/`. No ejecuta ninguna accion sobre sistemas
  externos.
- **No modifica produccion**, en ningun caso.
- **No toca WordPress, Google Ads, GA4/GTM ni n8n.**
- **No publica nada.**
- **No modifica `.env`** ni ninguna configuracion de credenciales.
- **No maneja ni imprime secretos** (no los necesita: no toca ninguna API).
- **Toda accion real requiere aprobacion humana explicita** antes de
  ejecutarse, igual que las tareas del SEO Watcher (ver
  `docs/approval-policy.md`).

## 5. Como agrupa y prioriza

Cada tarea propuesta por el SEO Watcher se agrupa con las demas que
comparten la misma **keyword** y **pagina** (varias oportunidades sobre el
mismo par keyword+pagina se convierten en UNA sola accion combinada, por
ejemplo "optimizar on-page" + "mejorar CTR" sobre la misma URL).

Para cada grupo se calcula:

- **Prioridad**: la mas alta entre las oportunidades del grupo.
- **Esfuerzo estimado** (`low`/`medium`/`high`): segun el tipo de
  oportunidad mas costoso del grupo (CTR = bajo, quick win/caida de
  posicion = medio, oportunidad futura/contenido nuevo = alto).
- **Impacto estimado** (`low`/`medium`/`high`): combinacion de prioridad e
  impresiones totales del grupo.
- **Requiere WordPress**: si el grupo incluye alguna oportunidad de
  contenido (no solo una caida de posicion, que puede ser un problema
  tecnico ajeno a WordPress).
- **Requiere contenido nuevo**: si el grupo incluye una `future_opportunity`.
- **Requiere revision humana**: siempre `true`.

El plan final ordena los grupos por prioridad, luego por impacto, luego
por impresiones, y destaca el top 5 como "acciones recomendadas para hoy/
esta semana".

## 6. Formato de salida

`reports/seo-director/seo-director-<fecha-de-ejecucion>.md`, con:

- Resumen ejecutivo.
- Top 5 acciones recomendadas para hoy/esta semana, cada una con: pagina a
  tocar, keyword a atacar, posicion actual/objetivo, por que merece la
  pena, accion sugerida, esfuerzo estimado, impacto estimado, si requiere
  WordPress, si requiere contenido nuevo, si requiere revision humana.
- Tabla completa con todas las acciones agrupadas (no solo el top 5).
- Confirmacion de seguridad (nada tocado en produccion).

## 7. Integracion con el email diario

`npm run seo:daily` (ver `docs/email-reporting.md`) ejecuta el SEO Watcher
y, con las tareas de esa misma ejecucion (en memoria, sin releer
`jobs.jsonl`), genera tambien el plan del SEO Director y anade una seccion
"Que haria ahora (SEO Director) — top 3" al email, ademas de escribir el
informe completo en `reports/seo-director/`.

## 8. Como evoluciona

Hoy el SEO Director solo sintetiza lo que ya detecto el SEO Watcher. Mas
adelante, cuando exista el Agente Director general (ver `docs/vision.md`),
este agente podria alimentar directamente sus decisiones de priorizacion
entre departamentos — pero eso no esta implementado todavia.
