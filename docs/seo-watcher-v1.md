# SEO Watcher Agent — v1 (cierre operativo)

Estado a 2026-08-02. Este documento resume que incluye la version 1 del
SEO Watcher Agent, que no incluye todavia, y como operarlo dia a dia.
Complementa (no sustituye) la spec funcional en
[`departments/web-growth/agents/seo-watcher.agent.md`](../departments/web-growth/agents/seo-watcher.agent.md).

## Que incluye v1

- **Analisis de oportunidades SEO**: `quick_win`, `low_ctr`,
  `position_drop`, `future_opportunity`, segun los umbrales de
  `config/thresholds.json` y las keywords de
  `config/seo-target-keywords.json`.
- **Dos fuentes de datos intercambiables**: `mock` (fichero local, sin
  credenciales) y `search_console` (API real de Google Search Console,
  solo lectura, OAuth2). Se elige con `SEO_DATA_SOURCE`.
- **Conexion OAuth2 real y verificada** contra `sc-domain:zentrylockers.com`
  (o el dominio que se configure en `GSC_SITE_URL`), scope unico
  `webmasters.readonly`. Sin service account JSON, sin Workload Identity
  Federation.
- **runId por ejecucion** (`seo-watcher-<fecha>T<hora>Z`), que agrupa todos
  los jobs y el informe de esa ejecucion.
- **Metadata en cada job**: `runId`, `analysisStartDate`,
  `analysisEndDate`, `siteUrl`, `dataSource`, ademas de `createdAt`.
- **Deduplicacion intra-ejecucion**: si la misma oportunidad (mismo
  tipo+keyword+pagina) se detectara mas de una vez en la misma corrida, solo
  se crea un job. El historico entre ejecuciones **no** se deduplica
  todavia (ver "Que NO incluye v1").
- **Informe markdown por dia de ejecucion** en `reports/seo/`, con resumen
  ejecutivo, desglose por tipo, top 10 priorizado y recomendaciones.
- **Logging con redaccion de secretos**, incluyendo saneado de mensajes de
  error de la libreria `googleapis` (que pueden traer cabeceras HTTP).

## Que NO incluye v1 (deliberado)

- **Nada de modo `APPLY`**: el agente no ejecuta ningun cambio real en
  WordPress, Google Ads, GA4, GTM ni n8n. Solo lee y propone.
- **Sin cron ni timers**: cada ejecucion es manual (`npm run seo:watch`).
  No hay automatizacion de periodicidad todavia (ver "Proximos pasos").
- **Sin `position_drop` en datos reales**: la API de Search Console no
  devuelve un "periodo anterior" en la misma llamada; hoy solo el adaptador
  mock incluye `previousPosition`. Detectar caidas de posicion con datos
  reales requiere una segunda consulta (periodo previo) y comparar.
- **Sin deduplicacion entre ejecuciones**: `data/jobs.jsonl` acumula
  oportunidades dia tras dia sin comprobar si ya existia una fila
  equivalente de una ejecucion anterior. Es un backlog de propuestas, no
  una lista de estado actual.
- **Sin flujo de aprobacion formal**: aprobar o rechazar una tarea hoy es
  un proceso manual (leer `jobs.jsonl` o el informe y decidir fuera del
  sistema). No hay botones ni webhook de aprobacion.
- **Sin notificaciones**: no envia nada a Slack/Telegram/email. Hay que
  entrar a leer el informe o `jobs.jsonl`.

## Operacion dia a dia

```bash
cd /opt/zentry-ai-department
npm run seo:watch
```

Cada ejecucion:
1. Lee datos SEO (mock o Search Console real, segun `SEO_DATA_SOURCE`).
2. Detecta oportunidades y las anade a `data/jobs.jsonl` (deduplicadas
   dentro de esa ejecucion).
3. Escribe `reports/seo/seo-watcher-<fecha-de-hoy>.md`.
4. Escribe `logs/seo-watcher-<fecha-de-hoy>.log`.

Revision recomendada tras cada ejecucion: abrir el informe en
`reports/seo/`, mirar el "Top 10" y las "Recomendaciones siguientes", y
decidir manualmente que tareas pasar a ejecucion (fuera de este sistema,
por ahora).

## Proximos pasos recomendados

1. **Automatizar la periodicidad** (cron o el scheduler que se decida) para
   ejecutar `npm run seo:watch` de forma regular — explicitamente fuera de
   alcance de esta fase (v1 es manual a proposito).
2. **`position_drop` con datos reales**: anadir una segunda consulta a
   Search Console (periodo anterior) para poder comparar posiciones.
3. **Deduplicacion entre ejecuciones**: decidir una politica (por ejemplo,
   no crear un job nuevo si ya existe uno `proposed` para la misma
   oportunidad en los ultimos N dias).
4. **Notificaciones**: conectar el resumen/informe a Slack o Telegram.
5. **Conectar el Agente Director** una vez haya un segundo agente/
   departamento real que coordinar (ver `docs/vision.md`).
6. **Modo `APPLY` (mas adelante, con aprobacion explicita por tarea)**:
   empezar por la accion de menor riesgo (por ejemplo, actualizar meta
   title/description via WordPress MCP) y solo para jobs ya aprobados
   manualmente.
