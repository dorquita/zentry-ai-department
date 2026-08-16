# De recomendacion a ChangePlan ejecutable

Por que la pasada coordinada producia 9 cambios propuestos y 0
ChangePlans, y que se ha cambiado para que deje de hacerlo.

## El sintoma

Pasada real `dept-2026-08-16T134942Z` (GitHub Actions run `31950916906`):

| Señal | Valor |
| --- | --- |
| SEO / Growth / Web Engineer | `executed` |
| QA | `pass_with_warnings` |
| Cambios propuestos | 9 |
| ChangePlans declarados | 0 |
| ChangePlans ejecutables | 0 |
| Propuestas `ACTIONABLE` | 0 |
| Escrituras en staging / produccion | 0 / 0 |

Las ocho recomendaciones acababan en el MISMO estado
(`requires_manual_staging_implementation`) con el MISMO texto, aunque las
causas no tenian nada que ver entre si.

## Las cuatro causas raiz

### 1. El contrato del agente no conocia `changePlans[]`

`.claude/agents/web-engineer.md` -- las instrucciones que el subagente lee
como suyas -- describia el JSON de salida SIN el campo `changePlans`, y
ademas prohibia en bloque *"No generes HTML, bloques de Gutenberg, codigo
PHP/CSS/JS, ni ningun artefacto de implementacion real"*. Las reglas de la
pasada coordinada, inyectadas despues en el mismo prompt, SI pedian
`changePlans[]` con el contenido nuevo completo. El modelo tenia dos
instrucciones contradictorias y obedecio la suya. **Resultado: 0 planes
declarados, siempre, en todos los runs.**

Es la misma clase de fallo que el de `seo-specialist` (prosa del agente
contra JSON Schema): el contrato vivia escrito a mano en tres sitios y
dos de ellos se quedaron atras.

### 2. `recommendationId` era obligatorio y nunca se entregaba

`changePlans[].recommendationId` es obligatorio en el schema, el resolver
lo exige, y `buildApplyPlan()` lo casa contra
`` `${departmentRunId}#rec-${rank}` ``. Ese identificador **no aparecia ni
una sola vez en el prompt**. Aunque el modelo hubiera declarado un plan
perfecto, no habria casado con ningun elemento de apply, y se habria
perdido en silencio: nadie decia por que.

### 3. La recomendacion llegaba SIN pagina

`seo-specialist` produce oportunidades y problemas tecnicos que SI llevan
`page`. Pero sus `prioritizedActions[]` no: llevan `relatedIds`
(`"T2/F1/O3/O6/O8/O9"`) que apuntan a esos elementos. El catalogo de
evidencia del departamento resumia la accion como prosa **con los
relatedIds y sin resolverlos**, asi que la URL se perdia en el salto
SEO -> Growth -> Web Engineer.

Lo que llegaba a ingenieria era literalmente *"Reescribir metas en las
paginas con CTR sistemicamente 0%"* sin decir cuales. El propio
`web-engineer` lo dejo escrito en su `validationPlan`: *"una vez
identificadas las URLs concretas (dato no disponible en este contexto)"*.

### 4. No habia BEFORE

`StagingPageBrief` -- el resumen del inventario que va al prompt -- llevaba
title, excerpt, tipos de bloque y H2, pero **no la meta Yoast actual ni el
`post_content`**. Sin eso, `update_post_meta` y `update_post_content` son
imposibles de proponer sin inventarse el estado actual, que es
exactamente lo que el agente tiene prohibido hacer.

## Lo que se ha cambiado

### Resolver central de paginas (`src/department/target-resolution.ts`)

`recommendation + evidencia -> referencias explicitas -> inventario real -> pageId`.

- Solo referencias **explicitas**: URL absoluta, o path con barra final.
  `GA4/GTM`, `24/7` y `y/o` no son paginas.
- La resolucion la hace `resolveStagingPage()`: igualdad exacta de id,
  URL de staging o slug, y **exactamente un candidato**.
- Una URL de **produccion** resuelve a la pagina de **staging** por slug,
  porque staging es un clon del mismo WordPress y el slug es la identidad
  canonica de la pagina en los dos entornos. Queda marcado como
  `crossEnvironment: true` y con su motivo.
- Cero fuzzy, cero similitud semantica, cero eleccion entre candidatos.
  UNA referencia que casa con VARIAS paginas del inventario no aporta
  ninguna (`ambiguous`, fail-closed).
- Una recomendacion que nombra VARIAS paginas a proposito ("consolidar
  el on-page de /a/ y /b/") es `multi_target`, no ambiguedad: no hay
  nada que elegir, se declara UN ChangePlan POR PAGINA y cada plan sigue
  teniendo un unico destino. La primera version de este resolver las
  bloqueaba, y con ellas justo el trabajo on-page real -- lo detecto la
  pasada `dept-2026-08-16T145334Z`.

### BEFORE real en el contexto

- `StagingPageBrief` ahora lleva `metaTitle` / `metaDescription` (los dos
  valores de la allowlist de Yoast). `null` nunca se rellena con algo
  derivado del title -- y ver mas abajo por que `null` no siempre
  significa "vacio".
- `targetPageSnapshots[]`: BEFORE **completo**, incluido el
  `post_content` real, solo de las paginas que han quedado resueltas como
  objetivo. Una pagina cuyo cuerpo no cabe en el presupuesto viene con
  `contentAvailable: false` y su motivo -- y `update_post_content` sobre
  ella cae en `missing_before`, no en "reescribe lo que quieras".
- El bloque `meta` crudo de la pagina NO se expone: podria traer
  metadatos de cualquier plugin.
- **La meta de Yoast no viaja por el REST del core de este sitio** (las
  claves `_yoast_wpseo_*` no estan registradas con `show_in_rest`):
  comprobado en la pasada `dept-2026-08-16T145334Z`, 0 de 44 paginas la
  exponen. Pagina a pagina eso es indistinguible de "no tiene meta"; a
  nivel de inventario, no. Cuando NINGUNA pagina la expone, el contexto
  lo dice por escrito (`yoastMetaUnavailableNotice`) y
  `update_post_meta` cae en `missing_before` -- escribirla seria pisar
  un valor que nunca vimos. Habilitar ese camino requiere exponer las
  claves por REST o leerlas por el fallback PHP, y es trabajo aparte.

### Contrato de salida alineado en las tres capas

`.claude/agents/web-engineer.md`, `config/web-engineer-output.schema.json`
y `src/employees/web-engineer/types.ts` dicen ahora lo mismo:
`changePlans[]` existe, `recommendationId` se copia literalmente de
`approvedRecommendations[].recommendationId`, y `newValue` es contenido
final -- no una descripcion del cambio.

La prohibicion de generar markup se ha acotado: sigue vigente para los
campos de especificacion, y **no** aplica a `changePlans[].newValue`, que
es justamente donde el contenido final es el entregable.

### Estados de resolucion diferenciados

`ChangePlanResolution`, siempre presente y siempre con motivo:

| Estado | Significa |
| --- | --- |
| `actionable` | Todo lo necesario para ejecutar existe |
| `unresolved_target` | No sabemos que pagina es |
| `ambiguous_target` | Una referencia casa con varias paginas: no se elige |
| `target_not_publishable` | Pagina resuelta pero no publicada |
| `missing_before` | Sabemos la pagina, no tenemos su estado actual |
| `missing_after` | No hay valor nuevo completo |
| `unsupported_operation` | Sabemos pagina y cambio, la capa APPLY no lo soporta |
| `no_change_needed` | El valor propuesto ya es el actual |
| `unknown_recommendation` | El plan no se remonta a ninguna recomendacion aprobada |
| `invalid_draft` / `invalid_plan` | Forma invalida |

`applyStatus` **no** cambia de vocabulario a proposito: lo comparte con la
maquina de estados persistente del cambio (Telegram, produccion). El
diagnostico vive en los campos nuevos `changePlanResolution` /
`changePlanResolutionReason` del elemento de apply.

### Instrumentacion

`reports/department/<runId>/web-engineer-diagnostics.json`: una fila por
recomendacion con `targetResolution`, `pageIdResolved`, `beforeAvailable`,
`afterDeclared` (y su longitud, nunca su contenido), `operationResolved`,
`capabilityResolved`, `changePlanStatus` y `reason`. Se vuelca al log de
la Action y viaja en el artifact.

## Banco de pruebas congelado

```
npm run department:replay-web-engineer -- \
  --context test/fixtures/dept-2026-08-16T134942Z-web-engineer-context.json \
  --output  test/fixtures/dept-2026-08-16T134942Z-web-engineer-output.json
```

Reejecuta SOLO el tramo determinista (resolucion de pagina, construccion
del ChangePlan, diagnostico) sobre el input REAL de la pasada que fallo.
No invoca a Claude, no toca la red, no escribe en ningun sistema. Iterar
una hipotesis pasa de ~18 minutos y seis invocaciones de Claude a unos
segundos. Ver `test/fixtures/README.md` para sus limitaciones.

## Segunda iteracion, guiada por la propia instrumentacion

La primera pasada real con el fix (`dept-2026-08-16T145334Z`, run
`31953899041`) siguio dando 0 ChangePlans -- pero ya **dijo por que**, una
recomendacion a una, y eso descubrio dos cosas que la primera version no
podia ver:

| # | Diagnostico | Lectura |
| --- | --- | --- |
| 1 | `qa_blocked` | Correcto: QA la bloqueo. |
| 2 | `no_change_plan_declared`, target **resuelto** (page 2060), BEFORE disponible | Correcto: "reasignar o cerrar acciones sobre una pagina obsoleta" es higiene de backlog, no una edicion de pagina. |
| 3 | `ambiguous_target` (1865 y 470) | **Falso negativo.** Era "consolidar el on-page de dos URLs": dos objetivos legitimos, no una eleccion. -> `multi_target`. |
| 4-6 | `no_target_reference` | Correcto: GA4/GTM y decisiones de alcance. |

Y el inventario dejo ver que **0 de 44 paginas exponen la meta de Yoast**
por REST. Las dos correcciones estan arriba. Sin el diagnostico por
recomendacion, las dos habrian seguido siendo invisibles detras de un
"0 ChangePlans".

## Lo que NO se ha tocado

SEM, Telegram, Cloudflare, D1, VPS legacy, produccion, la politica de
`execute-php`, los guards de produccion, usuarios, plugins/temas y
filesystem. La pasada diaria sigue siendo planificacion:
**staging writes = 0, production writes = 0.**
