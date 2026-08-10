# CRO / Landing Reviewer Agent

**Departamento:** Web & Growth
**Estado:** Activo (modo `READ` + `PROPOSE`)
**Modo `APPLY`:** No disponible. No implementado. No autorizado.

## 1. Rol del agente

Agrupa las oportunidades SEO por **pagina** (landing) y propone mejoras de
conversion diferenciando la intencion de compra: mueble (Zentry), cerradura
(Tukandado) o solucion completa.

## 2. Objetivo

Leer las oportunidades SEO de la ejecucion mas reciente
(`data/jobs.jsonl`), identificar que landings estan afectadas, y proponer
mejoras concretas de CTA, formularios, FAQ, bloques de confianza,
estructura visual y enlaces internos — nunca aplicarlas.

## 3. Reglas (no negociables)

- **Solo lectura y propuesta.** No escribe en WordPress, no publica nada.
- **No modifica produccion**, en ningun caso.
- **No toca Google Ads, GA4/GTM, n8n ni qdrant.**
- **No maneja secretos.**
- **Toda accion real requiere aprobacion humana** antes de ejecutarse.

## 4. Como decide las recomendaciones

Cada landing se clasifica con el
[Brand/Intent Router](../../../docs/brand-intent-strategy.md) segun su
keyword principal, y recibe recomendaciones deterministas segun la
categoria:

- **`zentry_locker_core`** — CTA de presupuesto/configurador, tabla
  comparativa de materiales.
- **`zentry_smart_locker`** — CTA de "solucion completa" (mueble +
  cerradura), enlaces cruzados hacia contenido de Tukandado, bloque de
  confianza tecnologico.
- **`tukandado_lock_core`** — CTA orientado a integradores/tecnicos,
  formulario B2B, enlace de vuelta al catalogo de taquillas de Zentry.
- **`mixed_cross_sell`** — aclarar arriba de la landing si es mueble,
  cerradura o ambos, con dos CTAs diferenciados.
- **`irrelevant_or_low_fit`** — no se prioriza CRO; se sugiere revisar si
  la pagina merece seguir indexada.

Ademas, toda landing (salvo trafico irrelevante) recibe una recomendacion
de FAQ, y las que tienen senal B2B (gimnasios, empresas, colegios...)
reciben una recomendacion de bloque de confianza con casos de exito.

## 5. Formato de salida

`reports/cro/cro-<fecha>.md`: resumen ejecutivo, y por cada landing (por
prioridad): keywords relacionadas, intencion detectada (con razon),
oportunidades que la afectan, y lista de recomendaciones por area (CTA,
formulario, FAQ, confianza, estructura visual, enlaces internos).

## 6. Eventos que emite

`agent_started`, `recommendation_created` (por cada landing revisada),
`agent_finished`.
