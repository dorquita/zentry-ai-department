# Politica de aprobacion

## Principio

Cualquier accion que pueda afectar a un sistema de produccion, a datos de
clientes, a presupuesto publicitario, o a la presencia publica de
Zentry/Tukandado requiere **aprobacion humana explicita** antes de
ejecutarse. Ningun agente esta autorizado a saltarse este paso.

## Que SIEMPRE requiere aprobacion humana

- Publicar, editar o borrar contenido en WordPress (paginas, posts,
  landings, menus, plugins, temas).
- Crear, pausar, editar o borrar campanas, grupos de anuncios, keywords o
  presupuestos en Google Ads.
- Crear o modificar eventos, tags, triggers o versiones en GA4/GTM.
- Crear, editar, activar o ejecutar workflows en n8n.
- Enviar comunicaciones externas (email, Slack, Telegram, redes sociales)
  en nombre de la empresa.
- Cualquier llamada a un "mutate endpoint" de cualquier API externa
  (WordPress REST API en modo escritura, Google Ads API en modo escritura,
  etc.).
- Instalar, actualizar o desinstalar software, plugins o dependencias en
  servidores de produccion.
- Cualquier accion sobre credenciales, secretos o tokens.

Nada de esto cambia con la Fase O7 (politica de autonomia, ver
`docs/autonomy-policy.md`): la autonomia solo afecta a **planificacion**
(convertir una recomendacion en un plan detallado), nunca a estas
acciones de ejecucion real.

## Que NO requiere aprobacion (hoy)

- Leer datos de rendimiento (Search Console, GA4 en modo lectura, Google
  Ads en modo lectura).
- Generar propuestas, borradores o tareas (`jobs.jsonl`) para revision
  humana.
- Escribir logs locales (sin secretos) en `logs/`.
- **Desde la Fase O7:** convertir una recomendacion SEO/contenido/CRO/
  SEM/Analytics/competencia de riesgo bajo/medio en una work order
  (`status: auto_approved_for_planning` -> work order `auto_prepared`).
  Ver la excepcion documentada mas abajo.

## Como se pide aprobacion

Para acciones que caen en `waiting_approval` (tocarian produccion real, o
son de un tipo no reconocido por la politica de autonomia): una persona
revisa `npm run actions:list -- --status waiting_approval` y decide que
tareas pasar a ejecucion manual, con `npm run actions:update -- --status
approved`. Mas adelante esto podria formalizarse (por ejemplo, un canal
de Slack/Telegram con botones aprobar/rechazar, conectado via n8n), pero
hoy es un paso manual fuera de este sistema.

Cuando se implemente el modo `APPLY` para un agente, ese agente debe:

1. Marcar la propuesta como `requiresApproval: true` (ya lo hace hoy para
   cualquier accion de nivel `HUMAN_APPROVAL_REQUIRED`/`FORBIDDEN`).
2. Esperar una senal explicita de aprobacion (no inferirla, no asumirla
   por timeout, no asumirla por falta de rechazo).
3. Registrar quien aprobo y cuando, junto con la ejecucion resultante.

## Excepciones

**Fase O7 (2026-08-03): autonomia de planificacion, documentada aqui
antes de implementarse, tal como pedia esta seccion.** El sistema puede
auto-aprobar, **solo para planificacion** (nunca para ejecucion), las
acciones SEO/contenido/CRO/SEM/Analytics/competencia que la politica de
`config/autonomy-policy.json` clasifica como `AUTO_PLAN` (riesgo
bajo/medio). Concretamente:

- Se salta el paso de aprobacion humana para pasar de "recomendacion
  detectada" a "work order con plan detallado listo para revisar"
  (`status: auto_approved_for_planning` -> work order `auto_prepared`).
- **No** se salta, bajo ninguna circunstancia, el paso de aprobacion para
  ejecutar nada real: publicar en WordPress, activar Ads, modificar
  GA4/GTM, etc. siguen exigiendo aprobacion humana explicita como
  siempre, sin excepcion.
- El nivel `AUTO_DRAFT` (borradores WordPress no publicados, cambios Ads
  en PAUSED) esta definido en la politica pero **desactivado**
  (`enabled: false`) — no es una excepcion activa hoy.
- Cualquier `actionType` no reconocido por la politica cae por defecto en
  `HUMAN_APPROVAL_REQUIRED` (seguro: ante la duda, se pide aprobacion,
  siguiendo el principio de esta seccion).

Ver `docs/autonomy-policy.md` para el detalle completo (los 5 niveles,
como cambiar la politica, como desactivarla). No hay ninguna otra
excepcion. Si en el futuro se necesita ampliar esta, debe documentarse
aqui de forma explicita antes de implementarse, no despues.
