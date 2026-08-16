# `execute-php` como fallback controlado (STAGING)

Decisión arquitectónica: el AI Department puede usar
`novamira/execute-php` **cuando no exista una ability específica que
resuelva la operación** — sin tener que construir una ability nueva para
cada cambio pequeño.

Lo que **no** se ha hecho, y es lo primero que hay que entender:

```
   NO    execute-php: dangerous_forbidden  ->  allowed
   SÍ    execute-php: dangerous_forbidden  +  una puerta lateral estrecha
```

En [`config/novamira-allowlist.json`](../config/novamira-allowlist.json)
la ability **sigue siendo `dangerous_forbidden`**. Esa clasificación es la
que leen `isNovamiraAbilityAllowed()` e `isAbilityAllowedForProfile()`, así
que cualquier llamada por la puerta general —de cualquier especialista,
con cualquier perfil, con cualquier flag— **falla exactamente igual que
antes**. Lo que se añade es una segunda puerta, con su propio contrato y
su propio guard, a la que un especialista no puede llegar porque no tiene
con qué construir la petición.

---

## 1. El flujo

```
  Recommendation
      ↓
  Web Engineer            (especifica; NO escribe)
      ↓
  QA                      (PASS / PASS_WITH_WARNINGS)
      ↓
  Elegir capability       selectExecutionPath()
      ├─ ¿existe ability nativa que lo resuelva? ──► native_ability
      └─ no existe / no sirve (con motivo)      ──► execute_php_fallback
                                                         ↓
                                            ChangePlan estructurado
                                                         ↓
                                        builder determinista (plantilla fija)
                                                         ↓
                                        assertExecutePhpAllowed(request)
                                                         ↓
                                            Novamira MCP → execute-php
                                                         ↓
                                              WordPress STAGING
                                                         ↓
                                     read-back (por REST, otro camino)
                                                         ↓
                                       validación → rollback si falla
```

Primera fase: **STAGING únicamente**. Producción no se toca y no queda
habilitada por nada de esto.

---

## 2. Cómo se decide native ability vs PHP fallback

`selectExecutionPath({ plan })` en
[`src/core/execute-php-operations.ts`](../src/core/execute-php-operations.ts),
apoyado en
[`novamira-ability-capabilities.ts`](../src/core/novamira-ability-capabilities.ts).

**Que exista una ability nativa NO basta para considerarla aplicable.**
La decisión tiene tres pasos, y el segundo es el que importa:

1. ¿Existe una ability nativa para esta operación?
2. ¿Soporta **realmente** el target/contenido solicitado?
3. Sólo entonces → `native_ability`. Si existe pero es incompatible →
   `execute_php_fallback` con un `nativeAbilityUnsuitableReason`
   **verificable**.

| Operación | Ability nativa | Camino |
|---|---|---|
| `update_post_content` con bloques **sólo `novamira/*`** | `gutenberg-write-content` | **native_ability** |
| `update_post_content` con **cualquier** bloque `core/*` | existe, pero **la rechaza** | `execute_php_fallback` |
| `update_post_content` clásico / vacío | existe, pero no aplica | `execute_php_fallback` |
| `update_post_title` / `_excerpt` / `_meta` | ninguna | `execute_php_fallback` |

### Por qué: lo que dice el servidor, textualmente

Leído con `mcp-adapter-get-ability-info` (modo `ability-info`), no
supuesto. `novamira/gutenberg-write-content`:

> *"Directly writes Gutenberg post_content **only when every supplied
> block is a registered Novamira-owned dynamic-only block**.
> Native/static Gutenberg blocks require browser JS finalization…"*
>
> `block_spec`: *"**Only registered `novamira/*` dynamic-only blocks are
> accepted here**."*
>
> instructions: *"For static/native blocks, **this ability refuses the
> write**."*

Así que `core/heading`, `core/paragraph`, `core/list` y `core/buttons`
**no** son escribibles por ella. Enrutarlos a la nativa dejaría el cambio
sin camino.

### ¿Y la cola de bloques nativos?

`gutenberg-add-pending-change` + `gutenberg-enable-batch-finalization`
sí aceptan bloques nativos, pero el propio servidor dice:

> *"Queued changes are **not live until** gutenberg-enable-batch-finalization
> marks the batch ready and **an open Block Editor Queue page** completes
> it."*
>
> *"if online is false, ask the **user** to open dashboard_url and **keep
> the Block Editor Queue page open**…"*

Exige un navegador humano abierto y no escribe por sí sola: **no es un
camino automatizable** para una pasada del departamento. Queda descartado
explícitamente, no por omisión.

### El motivo se deriva, no se declara

`selectExecutionPath` **ya no acepta** un `nativeAbilityUnsuitableReason`
del caller — era justo la puerta que esta función existe para cerrar. El
motivo sale de parsear los tipos de bloque del `ChangePlan`
([`gutenberg-blocks.ts`](../src/core/gutenberg-blocks.ts)) y cita el
bloque concreto que la nativa rechaza.

Y el guard **recalcula la selección entera** desde el plan y exige que
coincida (`capability_selection_mismatch`). Con eso:

- forzar PHP sobre contenido `novamira/*` compatible → bloqueado;
- forzar la nativa sobre un `core/heading` → bloqueado;
- mentir diciendo `nativeAbility: null` → bloqueado.

`executionPath` (`native_ability | execute_php_fallback`) se registra
**siempre**, en los dos casos.

---

## 3. Operaciones PHP permitidas

Habilitadas hoy — todas sobre STAGING, todas con rollback verificable:

| Operación | API de WordPress | Scope | Rollback |
|---|---|---|---|
| `update_post_content` | `wp_update_post(['post_content'=>…])` | `post_content` | reescribir el valor del snapshot |
| `update_post_title` | `wp_update_post(['post_title'=>…])` | `post_title` | ídem |
| `update_post_excerpt` | `wp_update_post(['post_excerpt'=>…])` | `post_excerpt` | ídem |
| `update_post_meta` | `update_post_meta()` / `delete_post_meta()` | `post_meta` | restaurar valor, **o borrar la clave si antes no existía** |

**Nunca SQL directo.** Existe API de WordPress para todo lo habilitado, y
`wp_update_post` dispara hooks, crea revisión, invalida caché y sanitiza
igual que una edición humana; un `UPDATE wp_posts` no hace nada de eso.
`$wpdb` está además en la lista negra del guard.

`update_post_meta` sólo acepta claves de una **allowlist cerrada**
(`_yoast_wpseo_title`, `_yoast_wpseo_metadesc`). Una clave libre sería una
puerta para escribir en cualquier metadato del sitio, incluidos los que
algunos plugins usan para permisos o tokens.

### Clasificadas aparte (NO se ejecutan en esta fase)

| Operación | Por qué queda fuera |
|---|---|
| `create_page` | El rollback de una creación es borrar, y eso deja residuo (ID consumido, papelera, referencias). Además exige política propia de status/slug/plantilla. |
| `update_redirect` | Depende del plugin de redirecciones instalado y **no hay inventario confirmado de plugins**. Elegir API a ciegas sería escribir en configuración global adivinando. |
| `update_term_assignment` | Reasignar taxonomías afecta a archivos, menús y canonicals más allá de la página objetivo, así que "no se tocó nada fuera del scope" no se puede comprobar releyendo sólo el post. |

Estas tres están en el catálogo con `enabled: false` y el guard las
rechaza (`failedCheck: "operation_not_enabled"`). Habilitarlas es una
decisión separada, no un cambio de configuración.

---

## 4. Operaciones prohibidas incluso con execute-php

`scanPhpForForbiddenOperations()` en
[`src/core/execute-php-guard.ts`](../src/core/execute-php-guard.ts). Se
aplica **siempre**, incluso al PHP que generan nuestras propias
plantillas: si una plantilla se rompiera en el futuro, esto lo detiene.

| Categoría | Bloquea (entre otros) |
|---|---|
| usuarios/admin | `wp_insert_user`, `wp_create_user`, `add_role`, `add_cap`, `grant_super_admin`, `wp_set_password`, `WP_User` |
| secrets/config | `wp-config`, `DB_PASSWORD`, `AUTH_KEY`, `$_ENV`, `getenv`, `.env`, `update_option`, `switch_to_blog` |
| filesystem | `file_put_contents`, `fopen`, `unlink`, `rename`, `mkdir`, `WP_Filesystem` |
| shell/system | `exec`, `shell_exec`, `system`, `passthru`, `proc_open`, `popen`, y el operador backtick |
| wp-cli | `WP_CLI` |
| plugins/themes/core | `activate_plugin`, `delete_plugins`, `switch_theme`, `update_core`, `*_Upgrader` |
| networking | `wp_remote_get/post/request`, `curl_init`, `fsockopen`, `file('http…')` |
| código dinámico | `eval`, `assert`, `create_function`, `call_user_func`, `include`, `require`, variables variables |
| sql directo | `$wpdb`, `mysqli_`, `PDO` |
| producción | cualquier aparición de `production` |

Es una **lista negra que se suma a una lista blanca**, no que la
sustituye. La lista blanca es la de verdad (§7).

---

## 5. El guard

`assertExecutePhpAllowed(request)` — fail-closed, y cada comprobación
devuelve un `failedCheck` estable que los tests verifican por nombre.

| # | Comprobación | `failedCheck` |
|---|---|---|
| 1 | Actor = `web_engineer_apply`. Ningún empleado Claude, y se compara contra `READ_ONLY_EMPLOYEES` para que añadir un empleado nuevo no pueda concederle PHP por olvido | `actor` |
| 2 | La ability **real** es `novamira/execute-php` | `ability_name` |
| 3 | Producción bloqueada de forma incondicional | `production` |
| 4 | `environment === "staging"` y `WORDPRESS_ENV === "staging"` | `environment` / `wordpress_env` |
| 5 | `NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED` | `flag_execute_php` |
| 6 | `NOVAMIRA_STAGING_WRITES_ENABLED` | `flag_novamira_writes` |
| 7 | QA ∈ {PASS, PASS_WITH_WARNINGS} | `qa` |
| 8 | `departmentRunId` + `recommendationId` + `changeId` presentes | `traceability` |
| 9 | ChangePlan válido y operación habilitada con rollback | `plan` / `operation_not_enabled` |
| 10 | El camino elegido es el fallback; la ability nativa se **re-deriva del catálogo** (no se cree lo que declare quien llama) y, si existe, se exige un motivo en su propio campo | `execution_path` / `native_ability_mismatch` / `native_ability_preferred` |
| 11 | **El PHP es exactamente el de la plantilla de ESTA fase** (`apply` escribe lo del plan; `rollback` escribe lo del snapshot — nunca "una de las dos") | `php_not_deterministic` / `rollback_without_snapshot` |
| 12 | Escaneo de operaciones prohibidas | `forbidden_operation` |

Sin trazabilidad no se escribe: **el audit trail es parte del permiso, no
un extra**.

### Nunca se confía en el nombre del tool MCP

Novamira no expone una tool por ability: expone
`mcp-adapter-execute-ability`, y la ability real viaja en el parámetro
`ability_name`. `resolveAbilityNameFromToolCall()` extrae ese parámetro y
es lo que se clasifica. Una llamada a `mcp-adapter-execute-ability` sin
`ability_name` utilizable se rechaza — no se puede clasificar el riesgo de
una ability que no se sabe cuál es.

---

## 6. ChangePlan / schema

```json
{
  "contractVersion": "execute-php-plan/v1",
  "operation": "update_post_excerpt",
  "targetId": 123,
  "expectedBeforeHash": "<sha256 de la versión sobre la que se propuso>",
  "payload": { "value": "…" },
  "scopeFields": ["post_excerpt"]
}
```

`validateExecutePhpChangePlan()` rechaza: versión de contrato distinta,
operación desconocida o no habilitada, `targetId` no entero positivo,
hash que no sea sha256 hex de 64, `scopeFields` que no coincidan
exactamente con los de la operación, payload con claves de más, y
**cualquier clave desconocida en el propio plan** — un plan con campos de
más es un plan escrito contra otro contrato.

---

## 7. Cómo se evita el PHP arbitrario

Tres capas, en orden de fuerza:

1. **Claude nunca escribe PHP.** Produce un ChangePlan estructurado. El
   único productor de PHP del sistema es
   [`execute-php-builder.ts`](../src/core/execute-php-builder.ts), que
   sólo sabe rellenar plantillas fijas.

2. **Ningún dato variable entra en el PHP como texto.** El contenido
   nuevo —que puede traer comillas, `<?php`, `$`, saltos de línea, lo que
   sea— viaja **siempre en base64**. La plantilla hace
   `base64_decode('…')`, y ese literal sólo puede contener
   `[A-Za-z0-9+/=]`. No existe ninguna cadena que, metida ahí, pueda
   cerrar la comilla y añadir código: la inyección desaparece **por
   construcción, no por escapado**. Los únicos huecos que no son base64
   son un entero y un hash hexadecimal, ambos validados por regex.

3. **Igualdad exacta contra el generador.** `phpMatchesPlan()` regenera
   el PHP desde el plan y exige que sea **idéntico** al que se va a
   enviar. No busca patrones malos (lista negra, siempre incompleta):
   exige que el código **sea** el generado — una lista blanca de un solo
   elemento. Un PHP escrito por un modelo, o alterado por el camino, no
   coincide y no pasa.

El PHP de **rollback** usa las mismas plantillas, a propósito: un
rollback con código propio sería código menos probado ejecutándose justo
cuando algo ya ha ido mal.

---

## 8. Snapshot

Antes de escribir, y en este orden:

1. Leer el estado **real** por REST.
2. Guardar el BEFORE (valor del scope + huella de todo lo que queda fuera).
3. Calcular `computeVersionHash` (status + title + meta + cuerpo).
4. Comparar con `expectedBeforeHash`.

Si no coincide → **`stale`**, y no se ejecuta nada. `runPhp` no se llega a
llamar.

---

## 9. Validación

Después de escribir:

1. **Releer** el estado real.
2. El valor del scope coincide con lo pedido, comparado **exacto salvo
   espacios**. Aquí NO se usa `normalizeForVersioning` (quita etiquetas y
   pasa a minúsculas): esa tolerancia es correcta para detectar deriva,
   pero como verificación posterior daría por "validado" un cambio que
   sólo tocara un `href` o el uso de mayúsculas sin haberse escrito.
3. **Nada fuera del scope cambió** — se compara la huella completa:
   status, slug, título, excerpt, hash del cuerpo y cada clave de meta.
4. Si `execute-php` no devuelve su marcador de resultado, se declara
   explícitamente que **el PHP no llegó a ejecutarse** — no se diagnostica
   como "el contenido no coincide".
5. Se registra el resultado.

> Nunca se considera éxito porque `execute-php` devolviera OK. La lectura
> se hace además **por REST**, un camino distinto al de la escritura (MCP),
> así que la validación no puede confirmarse a sí misma.

---

## 10. Rollback

Reescribir el valor del snapshot con la misma plantilla → **releer** →
comprobar que el scope y todo lo de fuera vuelven a coincidir con el
snapshot. Un rollback que no se verifica no es un rollback.

- El rollback pasa por el **mismo guard**. Que una escritura sea "de
  vuelta" no la exime.
- `rollback_failed` es crítico: se dice que requiere intervención humana y
  el sistema no vuelve a tocar la página.
- Una operación sin rollback seguro **no se ejecuta** (§3).

---

## 11. Audit trail

Append-only en `data/execute-php-audit.jsonl`:
`departmentRunId`, `recommendationId`, `changeId`, `actor`, `ability`,
`executionPath`, `nativeAbilityConsidered`, `capabilityReason`,
`environment`, `operation`, `target`, `phpSha256`, `beforeHash`,
`afterHash`, `validation`, `rollback`, `outcome`, `at`, `detail`.

**No se guarda el PHP completo** — lleva incrustado el contenido nuevo, y
un log versionado no es sitio para eso. Se guardan el tipo de operación
(catálogo cerrado) y el **SHA-256** del PHP, suficiente para probar que se
ejecutó exactamente el código que generan las plantillas. Antes de
escribir cada línea se comprueba que no contiene el valor de ninguna
variable sensible; si lo contuviera, no se escribe.

---

## 12. Producción

`execute-php` **NO queda habilitado en producción** por nada de esto.
Producción sigue con su carril REST, sus cuatro interruptores propios y
aprobación humana explícita de la versión exacta. El guard bloquea
`production` de forma incondicional (§5, comprobación 3) y el executor
sólo conoce staging.

---

## 13. Interruptores

| Variable | Efecto |
|---|---|
| `NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED` | Interruptor propio del fallback. Sin él, nada de esto se ejecuta. |
| `NOVAMIRA_STAGING_WRITES_ENABLED` | Interruptor general de escritura por Novamira. |
| `WORDPRESS_ENV` | Debe ser exactamente `staging`. |

Los tres son necesarios. Apagar cualquiera desactiva el fallback.

---

## Ver también

- [`manual-approval-flow.md`](manual-approval-flow.md)
- [`department-apply.md`](department-apply.md)
- [`wordpress-safety-policy.md`](wordpress-safety-policy.md)

---

## 14. E2E reales ejecutados (2026-08-16)

### 14.1 — Cambio de H2 (`core/heading`) por el fallback

Página: `https://staging.zentrylockers.com/digitalizacion-taquillas/`
(post **1867**). Elegida entre las que tienen un `core/heading` real por
ser la menos crítica: informativa, no comercial, no es la home ni la
página de presupuesto, y no figura en el backlog SEO del Daily Brief.

Bloques reales de la página: `core/button`, `core/buttons`,
`core/heading`, `core/image`, `core/list`, `core/paragraph`,
`yoast/faq-block`. Ninguno es `novamira/*` → `selectExecutionPath()`
deriva `execute_php_fallback` **del contenido**, sin que nadie declare
nada.

> **Censo del sitio**: en las 50 páginas publicadas de staging **no hay
> ni un solo bloque `novamira/*`**. Todo es `core/*`, `kadence/*`,
> `yoast/*` y `complianz/*`. Es decir: hoy `gutenberg-write-content` no
> puede escribir **ninguna** página de este sitio. La corrección del
> selector no era teórica.

Run: [31945963268](https://github.com/dorquita/zentry-ai-department/actions/runs/31945963268).

| Paso | Resultado real |
|---|---|
| BEFORE (H2) | `"Problemas habituales con taquillas ya instaladas"` — versión `6cdc897a5d90` |
| Camino | `execute_php_fallback` — motivo derivado: *"…este contenido incluye 7 tipo(s) que no lo son: core/button, core/buttons, core/heading, core/image, core/list, core/paragraph, yoast/faq-block"* |
| Cambio temporal (H2) | `"Configurador de bancos [E2E execute-php 2026-08-16T12:02:41.895Z]"` — versión `8f1639a77440` |
| AFTER | `applied`, validación `passed`, releído por REST; **nada fuera de `post_content` cambió** |
| Reversión | plan nuevo con el `post_content` original → `applied` / `passed` |
| Read-back final (H2) | `"Problemas habituales con taquillas ya instaladas"` — versión `6cdc897a5d90` |
| **Idéntico al inicio** | **sí** (`identicalToStart: true`) |
| **Staging writes** | **2** |
| **Production writes** | **0** |

### 14.2 — Primer E2E: `post_excerpt` (run [31942175626](https://github.com/dorquita/zentry-ai-department/actions/runs/31942175626))

Página 2077 (`configurador-bancos`, prototipo interno), operación
`update_post_excerpt` — sin ability nativa. BEFORE `d782b5795d99` →
temporal `f18f92ff8d19` → reversión → final `d782b5795d99`,
`identicalToStart: true`, 2 escrituras en staging, 0 en producción.

### El primer intento falló, y eso es la mejor evidencia

El run [31941898596](https://github.com/dorquita/zentry-ai-department/actions/runs/31941898596)
escribió y **no aplicó nada**: el `input_schema` real de la ability dice
*"Do NOT include `<?php` tags"* porque hace `eval()`, y las plantillas lo
incluían. El sistema **no se creyó** el "ok" de `execute-php`: releyó, vio
que el valor no había cambiado, revirtió y verificó la reversión. La
página quedó intacta y el run acabó en rojo.

De ahí salieron dos correcciones, ninguna relajando nada:

- Las plantillas ya no llevan la etiqueta de apertura, y el resultado
  viaja en base64 para sobrevivir al anidamiento JSON del sobre MCP.
- Si `execute-php` no devuelve su marcador, ahora se dice **"el PHP no
  llegó a ejecutarse"** en vez de diagnosticarlo como "el contenido no
  coincide".

El esquema se obtuvo preguntando (`mcp-adapter-get-ability-info`, sólo
lectura), no adivinando — que es lo que había fallado.
