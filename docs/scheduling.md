# Programacion (systemd timer)

## Actualizacion Fase O4 (2026-08-02)

El timer (`zentry-seo-watcher.timer`, sin renombrar) sigue disparando a la
misma hora de siempre (08:00 UTC = 10:00 Madrid en verano), pero el
`.service` que ejecuta **ha cambiado**: antes corria
`npm run seo:daily` (solo SEO Watcher + email simple); ahora corre
`npm run growth:daily` — el pase diario completo del departamento Web &
Growth (8 agentes + un unico email consolidado del Growth Director). Ver
`docs/daily-growth-report.md`. El nombre del unit no se ha tocado a
proposito (una propuesta de renombrarlo, p.ej. a
`zentry-growth-department`, se dejaria para una fase separada).

## Por que systemd, no cron/n8n

Se usa un timer de systemd (no cron, no un workflow de n8n) porque:

- Es nativo del sistema (Ubuntu 24.04 en el VPS ya usa systemd), sin
  dependencias nuevas.
- No implica tocar n8n (regla explicita: no tocar n8n/qdrant).
- Los logs quedan en `journald`, consultables con `journalctl`, sin
  ficheros de log adicionales que gestionar.
- `Persistent=true` recupera automaticamente una ejecucion perdida si el
  servidor estuvo apagado a la hora programada.

## Archivos

- `infrastructure/systemd/zentry-seo-watcher.service` — que ejecutar
  (`npm run growth:daily` en `/opt/zentry-ai-department`, cargando
  `.env` via `EnvironmentFile`).
- `infrastructure/systemd/zentry-seo-watcher.timer` — cuando ejecutarlo.

Son plantillas versionadas en el repo. Los ficheros "vivos" que systemd
usa realmente estan en `/etc/systemd/system/` (fuera del repo) y se
actualizan copiando desde `infrastructure/systemd/`.

## ⚠️ Zona horaria — leer antes de instalar el timer

`OnCalendar` en el `.timer` se interpreta en **la zona horaria del
sistema**, no en Europe/Madrid a menos que el servidor este configurado
asi. Comprobar con:

```bash
timedatectl
```

Si el VPS esta en `Etc/UTC` (como se detecto el 2026-08-02), un
`OnCalendar=*-*-* 10:00:00` dispara a las **10:00 UTC**, que equivale a:

- **12:00 en Madrid** en horario de verano (CEST, UTC+2, aprox.
  finales de marzo a finales de octubre).
- **11:00 en Madrid** en horario de invierno (CET, UTC+1).

**Decision tomada (2026-08-02):** no se toca la zona horaria del sistema
(sigue en `Etc/UTC`, no afecta a n8n/journald/etc). El timer se ajusta a
`OnCalendar=*-*-* 08:00:00` (UTC), que hoy — horario de verano, CEST —
equivale a las 10:00 en Madrid. **Pendiente:** al entrar el horario de
invierno (CET, ultimo domingo de octubre), 08:00 UTC pasa a ser las 09:00
en Madrid; hay que mover el timer a `09:00:00` a mano en ese momento (y
de vuelta a `08:00:00` en primavera) si se quiere mantener siempre las
10:00 Madrid exactas. No hay ningun mecanismo automatico para esto todavia.

Alternativa descartada por ahora: cambiar la zona horaria del sistema a
`Europe/Madrid` (`timedatectl set-timezone Europe/Madrid`) evitaria el
ajuste estacional del timer, pero afecta a **todos** los timestamps del
VPS (logs de n8n, journald, cron, etc.), no solo a este timer — se
descarto para no tocar nada fuera del alcance de este proyecto.

## Instalar (solo tras validar manualmente `npm run seo:daily`)

```bash
cp infrastructure/systemd/zentry-seo-watcher.service /etc/systemd/system/zentry-seo-watcher.service
cp infrastructure/systemd/zentry-seo-watcher.timer /etc/systemd/system/zentry-seo-watcher.timer
systemctl daemon-reload
systemctl enable zentry-seo-watcher.timer
systemctl start zentry-seo-watcher.timer
```

## Verificar

```bash
systemctl status zentry-seo-watcher.timer
systemctl list-timers | grep zentry
```

`list-timers` muestra la proxima ejecucion prevista (`NEXT`) y cuando fue
la ultima (`LAST`) — util para confirmar que la hora calculada es la
esperada antes de dar el timer por bueno.

## Ver logs de una ejecucion programada

```bash
journalctl -u zentry-seo-watcher.service --no-pager -n 100
```

## Prueba puntual (una sola vez, sin esperar al timer diario)

Para probar sin modificar el timer instalado, un unit transitorio de
systemd-run:

```bash
systemd-run --on-active=5m --unit=zentry-seo-watcher-test /usr/bin/bash -lc 'cd /opt/zentry-ai-department && npm run seo:daily'
```

Verificar con:

```bash
journalctl -u zentry-seo-watcher-test --no-pager -n 100
```

Este unit de prueba es transitorio (no queda instalado permanentemente;
no requiere `daemon-reload` ni limpieza posterior).

## Desinstalar / pausar

```bash
systemctl stop zentry-seo-watcher.timer
systemctl disable zentry-seo-watcher.timer
```

(no borra los ficheros de `/etc/systemd/system/`; para eliminarlos del
todo, borrar esos dos ficheros y `systemctl daemon-reload`).
