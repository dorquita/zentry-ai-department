# Politica de riesgo

## Clasificacion de riesgo por tipo de accion

| Accion | Riesgo | Permitido hoy |
|---|---|---|
| Leer metricas de rendimiento (Search Console, GA4, Ads) | Ninguno | Si |
| Generar propuestas/tareas (`jobs.jsonl`) | Ninguno | Si |
| Escribir logs locales sin secretos | Ninguno | Si |
| Editar contenido en WordPress | Alto | No (requiere `APPLY` + aprobacion, no implementado) |
| Crear/editar campanas o keywords en Google Ads | Alto | No |
| Modificar GA4/GTM (eventos, tags, triggers, versiones) | Alto | No |
| Crear/editar/ejecutar workflows en n8n | Alto | No |
| Instalar plugins o software en servidores | Alto | No |
| Leer o exponer secretos (`.env`, tokens, API keys) | Critico | No, nunca |

## Guardrails tecnicos del SEO Watcher Agent

- El adaptador mock (`src/adapters/search-console-placeholder.ts`) solo lee
  un fichero JSON local; no existe ningun metodo de escritura en su
  interfaz.
- El adaptador real (`src/adapters/search-console.ts`) solo llama a
  `searchconsole.sites.list` y `searchconsole.searchanalytics.query` — los
  dos metodos de lectura de la API de Search Console. No importa, no
  referencia y no llama a ningun metodo de escritura de esa API (por
  ejemplo `sitemaps.submit`/`delete` o `sites.add`/`delete`).
- El logger (`src/core/logger.ts`) redacta automaticamente cualquier campo
  cuyo nombre sugiera un secreto (`token`, `secret`, `password`, `key`,
  etc.) antes de escribir a consola o a fichero. El adaptador real anade
  una segunda capa: sanitiza tambien los mensajes de error de la libreria
  `googleapis` (que pueden incluir cabeceras HTTP) antes de loguearlos.
- Las credenciales (`GSC_*`) solo se leen de variables de entorno /
  `.env` local en el momento de autenticar; nunca se leen ni se imprimen
  ficheros de credenciales completos, solo se valida que la ruta exista.
- El registro de tareas (`src/core/job-registry.ts`) es de solo-append:
  nunca borra ni reescribe filas existentes en `data/jobs.jsonl`.
- La fuente de datos activa (mock o Search Console real) se decide con la
  variable `SEO_DATA_SOURCE`; por defecto es `mock`, asi que el
  comportamiento sin configuracion adicional sigue siendo cero llamadas de
  red.

## Que hacer ante una duda de riesgo

Si un cambio futuro (nuevo adaptador, nueva integracion, nuevo agente)
genera duda sobre si requiere aprobacion, la respuesta por defecto es
**si la requiere**, hasta que se documente explicitamente lo contrario en
`approval-policy.md`.
