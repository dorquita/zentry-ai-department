# De recomendacion aprobada a `ExecutableChangePlan`

Este documento describe el tramo que va de *"el departamento propone algo"* a
*"el sistema sabe exactamente que escribiria, donde, sobre que estado y como
lo desharia"* — y donde termina, deliberadamente, justo **antes** de escribir.

Modulos implicados:

| Fichero | Responsabilidad |
| ------- | --------------- |
| `src/adapters/staging-inventory-reader.ts` | Lee staging por REST. **Solo lectura.** |
| `src/department/staging-inventory.ts` | Inventario real + resolucion determinista del destino. |
| `src/department/executable-change-plan.ts` | El sobre ejecutable: target, before, after, preconditions, validacion, rollback, estado. |
| `src/department/web-engineer-changeplan.ts` | Une la intencion declarada por Claude con los hechos leidos. |
| `src/core/execute-php-operations.ts` | Catalogo cerrado de operaciones y contrato del executor (ya existia). |

## 1. Por que todo acababa en MANUAL

El cuello de botella no era el permiso ni la capacidad de escritura: era que
la recomendacion **nunca llegaba a tener un destino inequivoco ni un valor
final**. Cuatro capas contribuian, y las cuatro estan tocadas:

1. **El contrato de `web-engineer` no pedia un plan.** `.claude/agents/web-engineer.md`
   describia una salida de solo prosa (`proposedChanges`, `acceptanceCriteria`…),
   no mencionaba `changePlans[]` en ningun sitio, y ademas prohibia
   explicitamente "generar HTML o bloques de Gutenberg" — que es justo lo que
   `update_post_content` necesita. El campo existia en el JSON Schema, pero el
   agente no tenia motivo para rellenarlo.
2. **La capa de apply interpretaba prosa.** `resolveApplyCapability()` buscaba
   `page_id=N` y lineas `TITLE:` / `META:` dentro del texto de la
   especificacion. Nadie le habia dicho al agente que escribiera eso, asi que
   no aparecia nunca → `requires_manual_staging_implementation`.
3. **El estado no distinguia causas.** Todo lo que no era ejecutable caia en
   `MANUAL` / `REQUIRES MANUAL STAGING IMPLEMENTATION`, mezclando "la pagina no
   existe", "hay dos paginas candidatas", "falta decidir el texto" y "esa
   operacion no la sabemos hacer" — que exigen acciones completamente
   distintas.
4. **El BEFORE de las meta de Yoast no se leia de verdad.** El REST del core
   solo expone en `meta` las claves registradas con `show_in_rest`, y las de
   Yoast no lo estan: en el inventario real de la pasada
   `dept-2026-08-16T185140Z`, las 44 paginas traen `meta: {}`. Tratarlo como
   "el SEO title actual esta vacio" habria producido un rollback que **borra**
   un valor que si existia.

## 2. El reparto: LLM vs determinismo

La regla, sin excepciones:

```
CLAUDE (web-engineer) decide:        CODIGO DETERMINISTA decide:
  QUE deberia cambiar                  DONDE se cambia (page_id real)
  COMO deberia quedar (AFTER)          QUE hay ahora (BEFORE leido)
  por que (rationale)                  si se puede ejecutar
  criterios de aceptacion              si sigue siendo valido (STALE)
                                       como se deshace (rollback)
```

Consecuencias practicas:

- Claude **no aporta** `pageId`, `expectedBeforeHash`, BEFORE ni URL de
  produccion. No estan en su contrato y, si los pusiera, se ignoran.
- Claude **no decide que una URL existe**: cita paginas del `stagingInventory[]`
  que se le entrega ya leido. Si no puede citarla exactamente, el resultado
  correcto es no declarar plan.
- Claude **no lee credenciales y no ejecuta nada**. El subagente no tiene
  herramientas (`tools: []`).
- El `pageId`, el BEFORE, el hash de version, las preconditions, la validacion
  y el rollback salen **siempre** de la lectura real, en codigo puro y testeado.

## 3. Resolucion del destino (`resolveExecutionTarget`)

Prioridad fija, sin coincidencias parciales y sin "la que mas se parece":

1. `page_id` explicito, **si existe en el inventario**.
2. URL exacta conocida (normalizada: sin query, sin barra final).
3. Ruta exacta — solo si la referencia es una URL. Es lo que permite que una
   recomendacion escrita sobre `https://zentrylockers.com/taquillas-para-hospitales/`
   (produccion) resuelva contra la pagina equivalente de staging: cambia el
   entorno, no la ruta.
4. Slug exacto.

Resultados posibles:

- **0 coincidencias** → `UNRESOLVED_TARGET`.
- **más de 1** → `AMBIGUOUS_TARGET`, con los ids candidatos, para que decida
  una persona. Nunca se elige "el primero".

### `affectedPages` no es `executionTarget`

Una recomendacion puede mencionar 6 paginas como contexto y tener **un solo**
destino de escritura. Por eso:

- `targetPages[]` (salida de web-engineer) = contexto afectado, puede ser una
  lista.
- `changePlans[].targetPage` = el destino donde se escribe, **siempre uno**.
- Una referencia que enumera varios destinos (`countDistinctReferences() > 1`)
  se rechaza entera como `AMBIGUOUS_TARGET`: no se reparte sola ni se queda con
  la primera. Si la recomendacion afecta de verdad a N paginas, se declaran N
  planes, cada uno con su propio AFTER.

## 4. El sobre ejecutable

```jsonc
{
  "contractVersion": "executable-change-plan/v1",
  "changePlanId": "dept-...#rec-2#plan-update_post_title@1821",
  "recommendationId": "dept-...#rec-2",
  "environment": "staging",
  "target": { "pageId": 1821, "url": "https://staging.../taquillas-para-hospitales/", "slug": "...", "postType": "page", "resolvedBy": "..." },
  "operation": "update_post_title",
  "before":  { "post_title": "Taquillas para hospitales" },
  "after":   { "post_title": "Taquillas para hospitales y centros sanitarios | Zentry Lockers" },
  "preconditions": [ /* page_exists, page_status_is, version_hash_matches, field_equals */ ],
  "validation":    [ /* field_equals, out_of_scope_unchanged, page_status_unchanged */ ],
  "rollback":      { "operation": "update_post_title", "strategy": "restore_post_field", "values": { "post_title": "Taquillas para hospitales" }, "targetExistedBefore": true },
  "status": "READY_TO_EXECUTE",
  "executePhpPlan": { /* el contrato que ya consume el executor, sin duplicar la verdad */ },
  "observedAt": "2026-08-16T19:11:32.958Z"
}
```

`preconditions` y `validation` **no inventan semantica nueva**: declaran lo que
`src/department/apply/execute-php-executor.ts` ya hace hoy (comparar el hash de
version antes de escribir, releer el campo del scope, comprobar que nada fuera
del scope cambio y que el status sigue igual). Escribirlo en el plan permite
inspeccionar el contrato **antes** de conectar el executor.

`rollback.values` es, por construccion, el mismo objeto que `before`: revertir
no depende de que nadie recuerde nada. Caso especial: si la clave de meta no
existia antes (`targetExistedBefore: false`), revertir es **borrarla**, no
escribir cadena vacia.

### Persistencia

El objeto es JSON plano: sin clases, sin fechas vivas, sin referencias. Este
modulo no persiste nada y no conoce ningun backend. Se puede guardar en un
fichero, en una fila de PostgreSQL o en ningun sitio, sin rediseñarlo.

## 5. Estados y por que no es ejecutable

| `executionStatus` | Significa | Que hace falta |
| ----------------- | --------- | -------------- |
| `READY_TO_EXECUTE` | Destino real, BEFORE leido, AFTER concreto, rollback derivado. | Solo ejecutar (fase siguiente). |
| `UNRESOLVED_TARGET` | La pagina citada no existe en staging. | Corregir el destino de la recomendacion. |
| `AMBIGUOUS_TARGET` | Varias paginas candidatas, o varios destinos en una referencia. | Elegir uno, o partir en varios planes. |
| `TARGET_NOT_EXECUTABLE` | La pagina existe pero no esta publicada. | Publicarla o cambiar de destino. |
| `UNSUPPORTED_OPERATION` | Fuera del catalogo, deshabilitada, o `metaKey` fuera de la allowlist. | Habilitar la operacion con rollback verificable primero. |
| `NEEDS_ENGINEERING_DETAIL` | Falta el valor final: vacio, instruccion en vez de valor, o identico al actual. | Decidir el texto exacto. |
| `BEFORE_UNAVAILABLE` | El destino y la operacion valen, pero no se pudo leer el estado actual. | Exponer la clave en la lectura antes de poder revertirla. |
| `BLOCKED_BY_QA` | QA bloqueo la recomendacion. | Resolver el hallazgo de QA. |
| `STALE` | Staging cambio despues de construir el plan. | Volver a proponer sobre el estado actual. |
| `INVALID_PLAN` | El plan no valida contra el contrato del executor. | Bug: no se ejecuta. |

`status` (grueso: `ACTIONABLE` / `MANUAL` / `BLOCKED` / `STALE`) se mantiene
para lo que ya lo consume (Daily Brief, email, capa de apply).
`toProposalStatus()` es la unica fuente de la equivalencia:
**`READY_TO_EXECUTE` ≡ `ACTIONABLE`**.

## 6. Frescura (anti-TOCTOU)

`evaluateChangePlanFreshness(plan, currentPage)` reevalua las preconditions
contra un snapshot **fresco**. Cualquier incumplimiento deja el plan en
`STALE`: no se reajusta al estado nuevo, porque el AFTER se penso sobre el
contenido viejo y podria haber dejado de tener sentido. El ancla es el hash de
version de la pagina entera, no solo del campo: una edicion en otro campo
tambien invalida el plan.

## 7. Inspeccionar planes sin ejecutar nada

```bash
npm run change-plans:demo
npm run change-plans:demo -- --json reports/executable-change-plans/demo.json
```

Resuelve propuestas REALES de `dept-2026-08-16T185140Z` contra el inventario
REAL que leyo esa pasada. No abre red, no lee credenciales, no importa ningun
executor y no escribe en WordPress.

## 8. Que NO hace todavia esta fase

- No llama al executor, no escribe en staging y no toca produccion.
- No persiste los planes en ningun almacen nuevo.
- No lee las meta de Yoast (por eso `update_post_meta` sobre Yoast queda hoy en
  `BEFORE_UNAVAILABLE` con datos reales).

El siguiente paso es conectar `READY_TO_EXECUTE` con el executor de staging,
manteniendo snapshot, read-back, QA y rollback.
