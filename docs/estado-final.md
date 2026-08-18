# ZENTRY AI DEPARTMENT — ESTADO FINAL

> Informe de cierre de la puesta en marcha. Todo lo que aqui se afirma
> esta respaldado por una ejecucion real identificada por su `run_id` de
> GitHub Actions. No hay ninguna afirmacion derivada de leer el codigo y
> suponer que funcionaria: donde no hubo ejecucion, se dice.

## Veredicto

<!-- PENDIENTE: se rellena cuando A, B, C y D esten los cuatro cerrados. -->

## Flujo demostrado

```text
DATOS LIVE  (Search Console, GA4, GTM, Google Ads, inventario real de staging)
     |
     v
ESPECIALISTAS      seo-specialist / content-strategist / analytics-specialist
     |
     v
GROWTH DIRECTOR    sintetiza y prioriza
     |
     v
QA (recomendaciones)  <-- puerta 1
     |
     +--- FAIL --> requiredCorrections[] --> growth-director-v2 CORRIGE
     |                                              |
     |                       re-QA sobre el output NUEVO (max 2 rondas)
     |                                              |
     |              NEEDS_HUMAN_REVIEW <------------+
     |
    PASS
     |
     v
WEB ENGINEER       especificacion tecnica + changePlans[] (intencion)
     |
     v
RESOLUCION DETERMINISTA   pageId, valor BEFORE y ancla de version, leidos
     |                    del inventario REAL -- nunca del modelo
     v
QA DEL PLAN           <-- puerta 2, lo ultimo antes de escribir
     |
     +--- FAIL --> requiredCorrections[] --> web-engineer CORRIGE
     |                                              |
     |                       re-QA sobre el plan NUEVO (max 2 rondas)
     |                                              |
     |              NEEDS_HUMAN_REVIEW <------------+
     |
    PASS
     |
     v
APPLY EN STAGING   snapshot -> ancla de version (STALE si la pagina cambio)
     |             -> guard determinista -> escritura por
     |             novamira/execute-php -> READ-BACK por REST (via
     |             DISTINTA de la de escritura) -> validacion de scope
     |
     +--- validacion FALLA --> ROLLBACK automatico -> re-lectura ->
     |                          se registra el fallo
     v
PERSISTENCIA       MongoDB (estado autoritativo)
     |
     v
EMAIL              resumen humano de 150-250 palabras
     |
     v
PRODUCCION         inalcanzable por este camino, en cualquier caso
```

## Rollback

La reversion automatica no se afirma por diseño: se ejerce.

**Simulacro controlado (run 32087573582, `mode: rollback-drill`, post 1867).**
Se envenena UNA sola lectura -- la relectura posterior al apply, que es la
señal con la que el executor decide si lo escrito coincide con lo
planeado. Todo lo demas es real: la escritura ocurrio, el rollback lo
lanza el executor por su cuenta, reescribe en staging por el mismo
guard, y su verificacion posterior usa la lectura REAL sin tocar. El
simulacro es el disparador, nunca la respuesta.

El modo aborta en rojo si el resultado no es `rolled_back` o si la
pagina no queda identica al inicio. Termino en verde.

**Lo que encontro el primer intento (run 32087245294), que es la parte
que importa.** El simulacro fallo, y descubrio que el rollback automatico
del arnes de pruebas NUNCA habria funcionado:

```
CRITICO: el rollback fallo (execute-php guard: llamada BLOQUEADA
(php_not_deterministic). El PHP recibido NO coincide con la plantilla
determinista de la fase "apply" para este plan.)
```

El envoltorio del E2E declaraba `phase: "apply"` para toda escritura. Al
lanzarse el rollback, el guard comparo el PHP de reversion contra la
plantilla del apply, no coincidio, y bloqueo la propia reversion. El
apply ya habia escrito: **el post 1867 quedo a medias**. Se restauro por
el mismo camino auditado (run 32087496362) y se verifico releyendo.

El guard hizo exactamente su trabajo; lo que mentia era la fase
declarada. El camino REAL del departamento no tenia este fallo -- ya
deducia la fase del PHP recibido. El defecto vivia solo en el arnes,
que era precisamente el unico sitio donde el rollback jamas se habia
ejercitado, porque su reversion la pedia el propio script. Hay ahora un
test que prohibe fijar la fase a mano en cualquiera de los dos
envoltorios.

## Problemas encontrados durante la puesta en marcha

Todos los bloqueos reales resultaron ser **la misma clase de fallo**: un
predicado que pertenece a un camino decidiendo sobre otro camino
distinto. Ninguno era funcionalidad que faltara.

| # | Sintoma | Causa real |
| - | ------- | ---------- |
| 1 | La pasada terminaba en `requires_manual_staging_implementation` con un ChangePlan ejecutable ya construido | La fase `stage` filtraba por la capacidad LEGACY (la que interpreta prosa buscando `page_id=N`). El ChangePlan estructurado se descartaba en silencio justo despues de haberse construido bien |
| 2 | Con los interruptores encendidos, seguia sin escribir | `WORDPRESS_BACKEND=local_preview` -- un guard del backend REST legacy -- cerraba la puerta al executor de execute-php, que no lo usa |
| 3 | `CRITICO: rollback fallido` sobre una pagina intacta | Se invento el actor `department_daily_apply`; la allowlist del guard solo admite `web_engineer_apply`. Se corrigio usando el actor correcto, **sin ampliar la allowlist** |
| 4 | Esa misma alarma era ademas falsa | Una llamada RECHAZADA antes de ejecutarse no escribio nada, luego no hay nada que revertir. Emitir la señal mas grave del sistema sobre una pagina sana entrena a ignorarla |
| 5 | El apply se colgaba 9 minutos | La fase `stage` abria MongoDB y no la cerraba: la conexion abierta mantiene vivo el event loop de Node y el proceso padre nunca recibia el fin del hijo |
| 6 | El bucle de correccion no se disparaba | Estaba construido sobre el PLAN, pero QA bloquea en la puerta ANTERIOR (Growth), donde web-engineer ni siquiera se invoca |
| 7 | Aun en la puerta correcta, no se disparaba | QA devolvia `fail` con 2 hallazgos criticos y `requiredCorrections` vacio; la regla propia descartaba informacion accionable que si estaba ahi |
| 8 | El rollback del arnes no podia ejecutarse | Fase de escritura fijada a mano (ver seccion Rollback) |

## Estado de produccion

**Cero escrituras en produccion en todas las ejecuciones de esta puesta
en marcha.** No es una politica declarada: es estructural.

- El guard de `execute-php` bloquea `production` de forma incondicional,
  antes de mirar cualquier otra cosa.
- `decideChangePlanExecution()` rechaza con `production_environment`
  cualquier entorno que no sea literalmente `staging` -- incluida la
  cadena vacia y cualquier variante de mayusculas.
- `MongoStagingChangeStore` rechaza por construccion toda transicion
  `production_*`.
- Los jobs que escriben no reciben ninguna credencial de produccion, ni
  siquiera apagada.
- Produccion sigue exigiendo la aprobacion humana que define la
  arquitectura actual. Nada de esta puesta en marcha la ha tocado.
