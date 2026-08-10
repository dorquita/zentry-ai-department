# Informe diario del departamento (Fase O9: ejecutivo + tecnico)

## Que es (rediseno Fase O9)

Cada pasada diaria (`npm run growth:daily`) genera ahora **dos informes
distintos**, con lectores distintos:

| Informe | Para quien | Contenido | Se envia por email |
|---|---|---|---|
| **Ejecutivo** (`reports/daily/executive-<fecha>.md`) | El responsable del departamento (no tecnico) | Lenguaje natural, deduplicado, priorizado. Sin IDs, sin rutas de servidor, sin comandos, sin nombres de agentes internos. Legible en menos de 2 minutos. | **Si — es el cuerpo del email diario.** |
| **Tecnico** (`reports/daily/technical-<fecha>.md`) | Quien mantiene/depura el sistema | IDs, estados internos, work orders, agentes, warnings completos, rutas de informes. Todo lo que antes tenia el unico informe de Growth Director. | No. Solo para auditoria/trazabilidad. |

Antes de la Fase O9 solo existia un informe (el tecnico), y ese era
literalmente el cuerpo del email — por eso resultaba imposible de leer
para alguien no tecnico (88 acciones listadas una por una, UUIDs, rutas
`/opt/...`, nombres de agentes como `seo-watcher`/`content-planner`...).
Esa version tecnica **no ha desaparecido**: sigue generandose integra,
solo que ahora vive en su propio fichero y ya no es lo que llega al
email.

## Por que dos informes y no uno

Un informe pensado para debugging (IDs, estados exactos, trazabilidad
completa) y un informe pensado para decidir (que ha pasado, que
recomienda el departamento, que necesita tu aprobacion) tienen
audiencias y objetivos incompatibles entre si. Intentar que un solo
documento sirva para las dos cosas es lo que hacia el informe anterior
ilegible. Separarlos no pierde informacion — el tecnico sigue teniendo
todo el detalle — solo evita que el 95% del contenido (interno) tape el
5% que de verdad importa decidir.

## Como se construye el informe ejecutivo

`src/core/executive-report.ts` (funciones puras, sin acceso a disco) hace,
en este orden, ANTES de redactar nada:

1. **Filtra acciones de baja calidad**: cualquier keyword que termine en
   una preposicion/conjuncion suelta ("cerradura para", "comprar
   taquillas para") se descarta del analisis y se cuenta aparte (aparece
   como bloqueo: "N sugerencias incompletas descartadas").
2. **Agrupa por pagina**: todas las acciones (SEO, contenido, CRO...) que
   apuntan a la misma URL se funden en una unica conclusion/recomendacion
   — nunca se muestran 5 recomendaciones distintas para la misma pagina.
3. **Normaliza keywords**: singular/plural y variantes con/sin
   preposicion ("taquillas melamina" / "taquillas de melamina",
   "hotel"/"hoteles", "colegio"/"colegios") se tratan como el mismo tema
   al agrupar por keyword (cuando no hay pagina asociada).
4. **Prioriza y limita**: como mucho 4 conclusiones, 3 acciones "para
   hacer ahora" y 3 "para estudiar mas adelante" — nunca una lista de
   decenas de acciones internas, y nunca mas acciones "para hacer ahora"
   de las que realmente hay clasificadas como prioridad alta.
5. **Redacta con honestidad sobre el origen del dato**: si hay posicion
   real de Search Console, se dice explicitamente ("dato real de Search
   Console"); si es una estimacion por analisis de competidores, se dice
   "estimacion", nunca se presenta como si fuera un dato de Google. Desde
   la Fase O11, si hay credenciales de Google Ads/GA4/GTM, el informe
   tecnico de SEM/Analytics Watcher incluye datos reales (solo lectura,
   ver `docs/google-ads-readonly.md`/`docs/analytics-readonly.md`); si no
   las hay, o si la lectura falla, el informe lo dice en una frase
   sencilla, sin nombrar variables de entorno.
6. **Nunca dice que se ha ejecutado algo que solo se ha preparado o
   recomendado.** La seccion "Estado de ejecucion" es siempre explicita:
   cambios publicados, campanas modificadas y analitica modificada
   figuran siempre como "Ninguno/Ninguna" (no existe ningun modo `APPLY`
   en este sistema).

Ver `docs/autonomy-policy.md` y `docs/notification-gateway.md` para lo
que decide la politica de autonomia/notificacion — el informe ejecutivo
solo REDACTA lo que esas politicas ya decidieron, nunca decide nada por
su cuenta.

## Fallback seguro si la generacion del informe ejecutivo falla

Si `buildExecutiveReportData()`/`renderExecutiveReportMarkdown()` lanzan
un error por cualquier motivo, Growth Director:

1. Registra el error completo (con stack trace) en el log tecnico
   (`logger.error`, nunca visible en el informe ejecutivo).
2. Escribe en su lugar un informe ejecutivo minimo y seguro
   (`buildFallbackExecutiveReportMarkdown()`): explica en una frase que
   hoy no se pudo generar el detalle, confirma que no se ha publicado
   nada, y remite al informe tecnico. **Nunca** vuelca datos internos sin
   filtrar como sustituto.
3. El resto del pase diario (incluido el envio del email) continua con
   normalidad — un fallo en la redaccion del resumen no bloquea todo el
   dia.

Si en cambio Growth Director entero no llega a ejecutarse (un error mas
grave, antes de poder generar ningun informe), el pase diario completo
falla con `process.exit(1)` y **no se envia ningun email** — preferible a
mandar uno a medias. Se ve en los logs de systemd (`journalctl -u
zentry-seo-watcher.service`).

## Orden de ejecucion (importa para que el informe sea preciso)

```
1. SEO Watcher
2. SEO Director
3. Competitor Intelligence
4. Content Planner
5. CRO / Landing Reviewer
6. SEM Watcher
7. Analytics Watcher
8. Approval Queue                  <- deduplica y clasifica todo lo anterior en el Action Backlog
9. Approved Action Planner         <- crea work orders draft para `approved` Y `auto_approved_for_planning`
10. SEO Work Order Builder         <- amplia las work orders draft de categoria SEO
11. Content Work Order Builder     <- amplia las de categoria contenido
12. CRO Work Order Builder         <- amplia las de categoria CRO
13. SEO Change Pack Builder        <- convierte work orders SEO elegibles en change packs
14. Content Change Pack Builder    <- convierte work orders de contenido elegibles en change packs
15. CRO Change Pack Builder        <- convierte work orders CRO elegibles en change packs
16. WordPress Draft Agent          <- convierte change packs listos en previews locales, y en
                                       borradores REALES de WordPress (siempre "draft") solo si
                                       WORDPRESS_DRAFTS_ENABLED=true + approved_to_execute +
                                       aprobacion de Telegram para ese borrador concreto
17. Approval Gateway               <- crea solicitudes de aprobacion (Fase O8) y avisa por Telegram si aplica
18. Growth Director                <- lee todo lo anterior YA actualizado y escribe ejecutivo + tecnico
19. Email final unico (cuerpo = informe ejecutivo)
```

**Growth Director corre casi al final a proposito.** Necesita leer el
Action Backlog, el Work Order Registry, el Change Pack Registry y el
Approval Request Registry ya actualizados del dia para poder deduplicar y
priorizar con precision — si corriera antes, reportaria el estado de
ayer.

## Contenido del informe ejecutivo

1. **Resumen del dia** — parrafo corto en lenguaje natural.
2. **Trabajo realizado hoy** — bullets agrupados (nunca una lista de
   acciones repetidas).
3. **Principales conclusiones** — 3 a 7, cada una con que se detecto, por
   que importa, que recomienda el departamento, prioridad y si es nueva
   de hoy o venia de dias anteriores.
4. **Acciones recomendadas** — "para hacer ahora" (hasta 5) y "para
   estudiar mas adelante" (hasta 5), cada una con motivo, impacto
   esperado, esfuerzo y si necesita aprobacion (siempre "si, antes de
   publicar" — nada se ejecuta solo en este sistema).
5. **Decisiones pendientes del responsable** — SOLO decisiones reales
   (acciones `waiting_approval` + solicitudes de Telegram `pending`).
   Las acciones auto-aprobadas para planificacion (`auto_approved_for_planning`)
   nunca aparecen aqui, porque no son decisiones que Pau tenga que tomar.
   Si no hay ninguna: "No hay decisiones pendientes hoy."
6. **Problemas o bloqueos** — en lenguaje sencillo (Ads/GA4/GTM sin
   conectar, sugerencias de busqueda incompletas descartadas...), sin
   nombres de variables de entorno.
7. **Estado de ejecucion** — cambios publicados / campanas modificadas /
   analitica modificada (siempre "Ninguno/Ninguna") + numero real y
   deduplicado de acciones preparadas para revision + numero de
   **change packs** concretos preparados (un unico contador agregado, sin
   listarlos uno a uno — ver `docs/change-packs.md`, para no duplicar lo
   que "Acciones recomendadas" ya muestra sobre las mismas oportunidades)
   + numero de **previews de WordPress** preparados y, si
   `WORDPRESS_DRAFTS_ENABLED=true`, numero de **borradores reales**
   creados en WordPress (siempre sin publicar) — ver
   `docs/wordpress-draft-agent.md`.
8. **Proximo paso recomendado** — una unica frase de cierre.

## Contenido del informe tecnico

Es, en esencia, el informe que existia antes de la Fase O9: actividad de
cada agente por su nombre interno, panel de autonomia (Fase O7) con
IDs, work orders con sus IDs y status exactos, **change packs** con sus
IDs/status/tipo de cambio y top 5 listos para revisar, **WordPress
Draft Agent** con `WORDPRESS_DRAFTS_ENABLED`, totales de previews/
borradores y pendientes de aprobacion, aprobaciones de Telegram (Fase O8)
con IDs, warnings completos, comandos de gestion del backlog, y rutas a
todos los informes por agente (`reports/seo/`, `reports/seo-director/`,
`reports/seo-change-packs/`, `reports/wordpress-drafts/`, etc. — esos
informes granulares por agente no han cambiado, siguen igual que
siempre).

## Asunto del email

Simplificado en la Fase O9 para que sea legible de un vistazo:

```
Web & Growth — Informe diario 2026-08-03: 12 propuesta(s) preparada(s), 2 por aprobar
```

o, si no hay nada pendiente de aprobar:

```
Web & Growth — Informe diario 2026-08-03: 12 propuesta(s) preparada(s), sin decisiones pendientes
```

## Como se ejecuta

```bash
npm run growth:daily
```

Requiere `SEO_DATA_SOURCE=search_console` y las variables
`SMTP_*`/`REPORT_EMAIL_*` de `.env.example`. Falla claro y pronto si falta
cualquiera, antes de tocar Search Console o el SMTP. Las variables de
Telegram (`TELEGRAM_*`) son opcionales.

## Relacion con `npm run seo:daily`

`scripts/run-daily-seo-report.ts` (`npm run seo:daily`) sigue existiendo
como herramienta manual — util para probar solo SEO Watcher + Director +
email sin ejecutar el resto del departamento. El **timer diario de
systemd** ejecuta `npm run growth:daily`. Ver `docs/scheduling.md`.

## Un solo email, nunca varios

`scripts/run-daily-growth-department.ts` llama a `sendReportEmail()`
**una sola vez**, al final, con el contenido del informe **ejecutivo**
(nunca el tecnico). Ningun agente individual envia su propio email dentro
del pase diario — solo escriben su informe y sus eventos (el Approval
Gateway puede enviar mensajes de Telegram, que es un canal distinto).

## Tests

`npm test` ejecuta `test/executive-report.test.ts` contra
`src/core/executive-report.ts` con datos sinteticos (no toca el VPS ni
datos reales): verifica que el informe ejecutivo nunca contiene UUIDs,
comandos `npm`, rutas `/opt/`, ni nombres de variables de credenciales;
que agrupa singular/plural/variantes correctamente; que limita el numero
de acciones mostradas; y que las decisiones pendientes nunca incluyen
acciones auto-aprobadas para planificacion. El detalle de cada caso vive
como nombre descriptivo directamente en `test/executive-report.test.ts`.
