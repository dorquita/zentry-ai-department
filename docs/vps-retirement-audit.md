# Auditoria de retirada del VPS (Fase O53)

Fecha: **2026-08-16**. Continua `docs/external-dependencies-audit.md` (Fase O50).

Pregunta que responde: *¿que capacidad sigue existiendo UNICAMENTE en
`/opt/zentry-ai-department` y bloquea considerar independiente al
departamento que corre en GitHub + Claude?*

> **Respuesta corta:** queda **una** dependencia real, y es indirecta:
> **ningun workflow persiste estado**. Todas las capacidades funcionales
> ya se ejecutan desde Actions, pero cada pasada escribe sus cambios de
> estado en un runner efimero y los pierde al terminar. El estado
> historico (`data/*.jsonl`) solo avanza porque el VPS lo commitea.
> Mientras eso siga asi, `VPS_RUNTIME_DEPENDENCIES = 0` es cierto para el
> CODIGO pero no para el SISTEMA.

---

## 1. Tabla de capacidades

| Capacidad | VPS | GitHub | Migrado | LIVE | Dependencia restante | Accion |
|---|---|---|---|---|---|---|
| Search Console | `seo-watcher` via systemd | FASE 0.5 de la pasada diaria | SI (O50) | pendiente de secretos | ninguna de codigo | cargar 3 secretos |
| GA4 | `analytics-watcher` via systemd | FASE 0.5 | SI (O50) | pendiente de secretos | ninguna de codigo | cargar 3 secretos |
| GTM | `analytics-watcher` via systemd | FASE 0.5 | SI (O50) | pendiente de secretos | comparte cliente OAuth con GA4 | cargar (los mismos 3) |
| Google Ads | `sem-watcher` via systemd | FASE 0.5 | SI (O51) | pendiente de secretos | ninguna de codigo | cargar 4 secretos |
| WordPress staging (lectura) | REST desde el VPS | ya en Actions | SI (previo) | SI | ninguna | ninguna |
| WordPress produccion (escritura) | REST gateado | `department-production-apply.yml` | SI (previo) | manual, gateado | ninguna | ninguna |
| Novamira MCP | desde el VPS | `novamira-mcp-probe.yml` | SI (previo) | SI | ninguna | ninguna |
| SMTP / email | `growth:daily` paso 26 | Daily Brief coordinado | SI (previo) | SI | ninguna | ninguna |
| Crawling de competencia | `competitor-intelligence` | FASE 0.6 | SI (O52) | SI | ninguna | ninguna |
| SEO (director, work orders, change packs) | pasos 2, 10, 13 | FASE 0.6 | SI (O52) | SI | ninguna | ninguna |
| SEM (agente) | paso 6 | FASE 0.5 recolecta; bloque [SEM] razona | SI | recoleccion + agente SI | ninguna | -- |
| Analytics (agente) | paso 7 | FASE 0.5 + `analytics-specialist` | SI | SI | ninguna | ninguna |
| Growth (director v1) | paso 25 | FASE 0.6 | SI (O52) | SI | ninguna | ninguna |
| Informes `reports/daily/*.md` | solo VPS | FASE 0.6 | SI (O52) | SI | no se persisten entre pasadas | ver §3 |
| Jobs / work orders / change packs | `data/*.jsonl` en el VPS | se LEEN en Actions | parcial | — | **no se escriben de vuelta** | ver §3 |
| Eventos (`department-events.jsonl`) | escritos por el VPS | se escriben en el runner y se pierden | parcial | — | **no se escriben de vuelta** | ver §3 |
| Backlog de acciones / aprobaciones | `data/*.jsonl` en el VPS | idem | parcial | — | **no se escriben de vuelta** | ver §3 |
| Datos historicos | ficheros del repo | mismos ficheros | SI | — | ninguna (ya estan commiteados) | ninguna |
| Scheduler | systemd timer 08:00 UTC | cron de Actions 07:00 UTC | SI (previo) | SI | ambos activos a la vez | apagar el timer cuando se decida |
| cron legacy | presente | — | n/a | — | no se ha tocado | dejar como esta |
| Agentes Claude | no existian | 6 empleados en Actions | SI (previo) | SI | ninguna | ninguna |
| Secrets / variables | `.env` del VPS | Actions Secrets | pendiente | — | los valores solo estan en el VPS | copiarlos |
| Filesystem local / almacenamiento | `/opt/...` persistente | runner efimero | **NO** | — | **es la causa raiz de §3** | decidir mecanismo |
| Queues | no hay | no hay | n/a | — | ninguna | ninguna |
| Scripts auxiliares one-off (`o34`–`o45`) | rutas `/opt` fijas | no alcanzables | n/a | — | **ninguna** (ver §2) | ninguna |

---

## 2. Referencias a `/opt/zentry-ai-department`, clasificadas

Se han localizado **90 apariciones** en el repositorio. Clasificacion:

| Clase | Cuantas | Donde | ¿Bloquea la retirada? |
|---|---|---|---|
| `runtime dependency` | **0** | — | — |
| `historical evidence` | 35 | `data/*.jsonl`, `reports/**` (rutas absolutas grabadas en eventos e informes ya generados) | NO |
| `documentation` | 12 | `docs/*.md`, `README.md`, `services/3d-model-factory/docs/` | NO |
| `harmless reference` | 43 | 36 scripts one-off `o34`–`o45`, plantillas systemd/deploy, backups de `clients/zentry/outputs/` | NO |

Comprobaciones que respaldan el `0` de runtime, automatizadas en
`test/vps-independence.test.ts`:

- **`src/`**: la unica aparicion esta dentro de un **comentario** de
  `src/employees/analytics-specialist/context.ts`, que explica por que el
  lector prueba primero la ruta local. Cero apariciones en codigo
  ejecutable.
- **Scripts alcanzables**: de los 96 scripts referenciados desde
  `package.json`, **ninguno** contiene la ruta del VPS. Los 36 que si la
  contienen son scripts operativos de un solo uso (`o34-…`–`o45-…`) que
  no invoca ni `npm run` ni ningun workflow — la interseccion entre
  "alcanzable" y "contiene `/opt/`" es **vacia**.
- **Workflows**: cero apariciones en `.github/`.

Las plantillas `infrastructure/systemd/*.service` y
`deploy/*.service` describen el VPS a proposito: son la definicion del
sistema que se va a retirar, no una dependencia de que siga vivo.

---

## 3. PERSISTENCIA DE ESTADO — la dependencia indirecta que queda

Este es exactamente el caso que habia que buscar: **GitHub parece
autonomo, pero consume ficheros que solo el VPS actualiza.**

Los 16 workflows declaran `permissions: contents: read` y **ninguno hace
`git commit`/`git push`**. Consecuencia real:

1. La pasada de Actions lee `data/action-backlog.jsonl`,
   `data/change-packs.jsonl`, `data/jobs.jsonl`,
   `data/department-events.jsonl`, `data/approval-requests.jsonl`,
   `data/opportunity-state-log.jsonl`, `data/work-orders.jsonl` … tal y
   como estan **commiteados**.
2. Durante la pasada, los agentes deterministas los modifican en el
   runner (append de eventos, transiciones de estado, nuevos change
   packs).
3. Al terminar el job, **el runner se destruye y esos cambios se pierden**.
4. La siguiente pasada vuelve a partir del mismo estado commiteado.

Es decir: aunque las cuatro fuentes Google esten LIVE, el departamento en
Actions **no acumula**. El backlog no avanza, las transiciones de estado
se recalculan desde cero cada dia, y una aprobacion registrada en una
pasada no existe en la siguiente. Hoy eso no se nota porque **el VPS
sigue commiteando** ese estado.

Marca: **`VPS_DEPENDENT` (indirecta)**.

### RESUELTO en la Fase O55 — rama de estado dedicada

La persistencia ya existe. Diseno implementado:

| Requisito | Como se cumple |
|---|---|
| Un unico escritor | Solo el job `persist-state` escribe, y el `concurrency` del workflow serializa las pasadas completas |
| Evitar conflictos | Rama `department-state` separada de `main`; `--force-with-lease` (nunca `--force`) con 3 reintentos |
| Evitar perdida de datos | `npm run state:verify` compara manifiestos antes/despues; si un `.jsonl` pierde lineas o un fichero desaparece, **no se persiste nada** |
| Conservar historial | Es una rama de git: un commit por pasada, con enlace al run |
| Permitir recuperacion | `git checkout department-state@{N}` |
| No contaminar `main` | Rama huerfana, sin historia comun con `main` |
| Sin VPS | Todo ocurre dentro de Actions |

Least privilege: el workflow tiene **dos jobs**. El que ejecuta los seis
empleados Claude sigue en `contents: read` — ningun agente puede escribir
en el repositorio. `contents: write` vive solo en `persist-state`, que no
ejecuta Claude, no llama a ninguna API externa y no corre codigo del
repositorio: descarga el artifact ya verificado y commitea.

La invariante que lo hace seguro: los `data/*.jsonl` son **estrictamente
append-only** (verificado sobre los 8 modulos que escriben estado: 8 usan
`appendFileSync`, 0 usan `writeFileSync`, y hay un test que lo fija). Que
un fichero de estado encoja es imposible en una pasada sana, asi que se
trata como fallo en vez de tolerarse.

### Por que NO se habilito antes

La solucion tecnica es directa (`contents: write` + un step que commitee
`data/` y `reports/` al final de la pasada), pero habilitarla **ahora
seria activamente peligroso**: el VPS sigue vivo y sigue escribiendo los
mismos ficheros. Dos escritores sobre los mismos JSONL append-only, sin
coordinacion, producen conflictos de merge y perdida de datos reales.

El orden correcto es el inverso al que parece:

1. Cargar los secretos y verificar LIVE (fases 4–6).
2. **Parar el timer del VPS** (`systemctl stop zentry-seo-watcher.timer`
   — parar, no borrar).
3. **Entonces** habilitar el commit-back en la pasada diaria, con un solo
   escritor.
4. Observar una pasada completa y comparar contra el ultimo informe del
   VPS.

Mientras tanto, la situacion esta declarada, no disimulada: el test
`test/vps-independence.test.ts` falla si alguien retira esta seccion del
documento sin haber habilitado la persistencia.

### Alternativas al commit-back, si no se quiere un bot escribiendo en `main`

- **Rama de estado dedicada** (`department-state`), que la pasada
  actualiza y de la que lee al arrancar. Aisla el ruido de `main`.
- **Artifact + restore**: subir `data/` como artifact y restaurarlo al
  inicio de la siguiente pasada. Mas fragil (retencion, "cual es el
  ultimo") y con el problema de "buscar el ultimo artifact de una
  ejecucion historica ambigua" que este repositorio ya evito a proposito
  en la coordinacion diaria.
- **Almacen externo** (D1 ya existe para aprobaciones). El mas robusto y
  el mas caro; ademas D1 esta explicitamente fuera de alcance ahora.

Recomendacion: **rama de estado dedicada**, tras parar el timer del VPS.

---

## 3b. Quien escribe el estado en el VPS, exactamente (Fase O55)

Distincion que resulto importante: **escribir en disco** y **publicar en
GitHub** son dos cosas distintas, y las hacen actores distintos.

| Actor | Que hace | Cuando | ¿Automatico? |
|---|---|---|---|
| `zentry-seo-watcher.timer` → `zentry-seo-watcher.service` → `npm run growth:daily` | Escribe `data/*.jsonl` y `reports/**` en el disco del VPS | 08:00 UTC diario | SI |
| `zentry-telegram-approvals.service` | Escribe `data/telegram-*.jsonl` y `data/approval-requests.jsonl` (long-poll permanente) | continuo | SI |
| Una persona por SSH (`root@srv1777637.hstgr.cloud`) | `git commit && git push` de `data/`+`reports/` a `main` | irregular | **NO** |

Verificado: **ningun fichero del repositorio ejecuta `git commit` ni
`git push`** — ni los scripts, ni las units systemd, ni nada bajo `src/`.
Y los commits de `root@srv...` estan a horas dispersas (15:59, 16:59,
18:48, 19:54, 20:12, 20:27 el 10 de agosto; 17:24 el 14), nunca a las
08:00 que dispara el timer. Son commits a mano.

**Consecuencia para la migracion:** no existe ni ha existido nunca un
escritor AUTOMATICO del VPS sobre el repositorio. Activar el escritor de
GitHub no crea una carrera con nada: escribe ademas en una rama distinta
(`department-state`), que el VPS no toca. La unica condicion es
**dejar de commitear `data/` a mano desde el VPS**, porque a partir de
ese momento esos commits serian estado paralelo que nadie lee.

`zentry-telegram-approvals.service` si sigue siendo un escritor en disco
del VPS, pero queda **fuera de alcance por decision explicita** (no tocar
Telegram). Mientras nadie commitee lo que escribe, no afecta al estado
que consume GitHub.

---

## 4. Prueba "VPS OFF" ejecutada

Se ha ejecutado el pase completo **sin nada corriendo en
`/opt/zentry-ai-department`**, con el mismo comando que usara Actions:

```
npm run growth:daily -- --departmentRunId growth-department-2026-08-16T140000Z \
                        --skip-watchers --no-email
```

Resultado real: **26/26 pasos, 0 fallos aislados**, y dos informes nuevos
generados durante esa misma ejecucion:

- `reports/daily/executive-2026-08-16.md`
- `reports/daily/technical-2026-08-16.md`

Verificaciones de seguridad de esa misma pasada:

- `can_attempt_real_writes=false` (Production Draft Executor)
- `produccion_tocada=false` (Production Deployment Planner)
- `telegram_activo=false` (Approval Gateway)

El informe generado dice, correctamente, que *"no se han podido validar
las conversiones porque la medicion de la web (GA4/GTM) todavia no esta
conectada"* — es decir, **no finge datos que no tiene**, que es
exactamente el comportamiento que se buscaba.

### Que seguiria fallando hoy con el VPS apagado

| Pieza | Con el VPS apagado |
|---|---|
| Fuentes Google (GSC/GA4/GTM/Ads) | funcionan **en cuanto existan los secretos**; hasta entonces, snapshot etiquetado `stale` |
| Informes diarios | **funcionan** (demostrado arriba) |
| Pipeline determinista de 26 agentes | **funciona** |
| Agentes Claude (6 empleados) | **funcionan** |
| Email del Daily Brief | **funciona** |
| WordPress / Novamira | **funcionan** |
| Acumulacion de estado entre pasadas | **NO funciona** — §3 |

---

## 5. Criterio de terminacion (Fase 12)

| Sistema | LIVE desde GitHub | Necesita VPS |
|---|---|---|
| Search Console | pendiente de secretos | codigo: NO |
| GA4 | pendiente de secretos | codigo: NO |
| GTM | pendiente de secretos | codigo: NO |
| Google Ads | pendiente de secretos | codigo: NO |
| WordPress | SI | NO |
| Growth Director | SI | NO |
| Daily Reports | SI | NO |
| Claude agents | SI | NO |

`VPS_RUNTIME_DEPENDENCIES = 0` **en el codigo** (verificado
automaticamente en `test/vps-independence.test.ts`).

`VPS_DEPENDENT = 1` **en el sistema**: la persistencia de estado (§3).

No se ha borrado `/opt/zentry-ai-department`, no se ha desactivado ningun
servicio, no se ha tocado ningun secreto del VPS y no se ha eliminado
ningun dato historico.
