# Email del Daily Brief del departamento

El Daily Brief de la pasada coordinada se envia por correo al terminar el
workflow. Es un informe **para un director**, no un volcado tecnico: el
informe completo (JSON + Markdown) sigue viajando en el artifact del run.

## Que contiene

1. **Resumen ejecutivo** — entre 5 y 8 lineas, nunca mas.
2. **Top priorities** — como maximo 8 (si habia mas, el correo dice
   cuantas quedaron fuera). Por cada una: titulo, por que importa,
   impacto, confianza, esfuerzo, evidencia resumida con su empleado de
   origen, QA status, accion propuesta con su estado de APPLY, y si
   necesita aprobacion.
3. **Approvals needed** — muy visible, con bloques `[APPROVAL REQUIRED]`.
4. **Estado de APPLY** — separando `READY FOR APPROVAL`,
   `APPROVED / QUEUED FOR APPLY`, `APPLIED SUCCESSFULLY`,
   `VALIDATION FAILED`, `ROLLED BACK`, `REJECTED`, `BLOCKED` y
   `REQUIRES MANUAL IMPLEMENTATION`.
5. **Blocked / unknown** — incluye siempre `SEM: pendiente`.
6. **Estado del departamento** — SEO, Content, Analytics, SEM, Growth, QA,
   Web Engineer.
7. **Coste de la pasada** — coste, duracion, turnos y modelo por empleado.
8. **Link al run de GitHub**.
9. **Mensaje de seguridad**: *"Este informe contiene propuestas. Solo las
   acciones que hayan pasado la puerta de aprobacion correspondiente
   pueden ejecutarse mediante APPLY."*

Se envian **las dos versiones**: texto plano y HTML.

**No se inventa ninguna metrica.** Todo numero sale del brief, del
contrato de apply o de los registros de coste reales de la pasada. Un
dato ausente se dice ("no reportado"), nunca se sustituye por 0.

## Configuracion (secretos del repositorio)

El envio reutiliza el mailer SMTP que ya existia (`src/core/mailer.ts`,
`nodemailer`). Secretos necesarios en
**Settings → Secrets and variables → Actions**:

| Secret | Para que |
|---|---|
| `DAILY_BRIEF_EMAIL_TO` | Destinatario del Daily Brief. **Preferido.** |
| `REPORT_EMAIL_TO` | Fallback si no existe el anterior (es el destinatario del cliente activo). |
| `REPORT_EMAIL_FROM` | Remitente. |
| `SMTP_HOST` | Servidor SMTP. |
| `SMTP_PORT` | Puerto. |
| `SMTP_SECURE` | Exactamente `true` o `false`. |
| `SMTP_USER` | Usuario SMTP. |
| `SMTP_PASS` | Contrasena SMTP. |

Si falta cualquiera de ellos, **no se envia nada**: el step reporta
`skipped_missing_config` con los **NOMBRES** de las variables que faltan.
Ningun valor aparece jamas en un log — ni el de la contrasena, ni el del
destinatario. El script ademas verifica, antes de guardar o enviar nada,
que el correo construido no contiene el valor de ninguna variable
sensible, y aborta si lo detecta.

## Ejecutar a mano

```bash
# Construye el correo y lo guarda en el run, sin abrir ninguna conexion SMTP
npm run department:email -- --departmentRunId <id> --dry-run

# Envio real
npm run department:email -- --departmentRunId <id> --runUrl <url del run>
```

El correo construido se guarda siempre en
`reports/department/<departmentRunId>/daily-brief-email.json` para poder
auditar despues exactamente que se envio.

## Schedule

El workflow coordinado corre **una vez al dia a las 07:00 UTC**
(`.github/workflows/zentry-ai-department-daily.yml`), que equivale
aproximadamente a las **09:00 en Espana en horario de verano** (CEST,
UTC+2) y a las **08:00 en invierno** (CET, UTC+1). Un unico cron a
proposito: nunca varias pasadas al dia. Se mantiene `workflow_dispatch`
para lanzarla a mano, y la `concurrency` sigue impidiendo dos pasadas
simultaneas. GitHub Actions puede retrasar un `schedule` en momentos de
carga: es comportamiento conocido de la plataforma.

Esta hora es independiente del timer de systemd del VPS
(`docs/scheduling.md`, 08:00 UTC), que ejecuta el pase determinista
`growth:daily`.

## Coste por empleado

Antes, las seis invocaciones de Claude de la pasada compartian el mismo
`execution_file` del runner y solo sobrevivia la ultima. Ahora el runtime
comun acepta un input opcional `execution-record-path` y cada empleado
guarda sus metricas en **su propia ruta** dentro de la pasada:

```
reports/department/<departmentRunId>/stages/<empleado>/claude-execution.json
```

Con empleado, modelo, duracion, coste, turnos, origen de la salida
(`structured_output` / `execution_file_fallback`) y resultado. El input es
opcional y vacio por defecto: los workflows de empleado individuales no
cambian de comportamiento.
