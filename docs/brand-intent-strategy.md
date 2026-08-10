# Estrategia de marca / intencion (Brand Intent Router)

## Por que existe

Zentry y Tukandado son dos marcas relacionadas pero distintas:

- **Zentry** vende principalmente taquillas, lockers y mobiliario. Tambien
  ofrece cerraduras electronicas/inteligentes como parte de la solucion.
- **Tukandado** vende principalmente la cerradura electronica/inteligente.
  Puede captar fabricantes de taquillas, integradores, o clientes que solo
  quieren la cerradura — pero tambien puede recibir oportunidades donde el
  cliente quiere el mueble completo.

Sin un criterio explicito, cualquier agente que analice keywords o
contenido podria mezclar ambas marcas sin sentido (proponer contenido de
Tukandado para una busqueda que es puramente de mobiliario, o al reves).
El **Brand/Intent Router** (`src/core/brand-intent-router.ts`) existe para
que esa decision sea siempre explicita, consistente entre agentes, y
explicada con una razon legible.

## Las 5 categorias

| Categoria | Marca | Cuando aplica |
|---|---|---|
| `zentry_locker_core` | Zentry | Menciona mobiliario/taquillas/lockers, sin mencionar cerraduras. |
| `zentry_smart_locker` | Zentry + Tukandado | Menciona mobiliario Y cerradura/calificativo "inteligente" a la vez — es la solucion completa. |
| `tukandado_lock_core` | Tukandado | Menciona cerradura/control de acceso, sin mencionar mobiliario. |
| `mixed_cross_sell` | Ambas | Sin mencion explicita de mueble ni cerradura, pero con contexto (sector/material) relevante. Requiere revision manual. |
| `irrelevant_or_low_fit` | Ninguna | Trafico de bajo valor (manuales, gratis, segunda mano, reset de clave) o sin ninguna senal relevante. |

## Orden de decision (lo que implementa el codigo)

1. **Bajo valor primero, siempre.** Si la keyword contiene una senal de
   bajo valor (`gratis`, `segunda mano`, `manual de instrucciones`, `como
   abrir sin llave`, `resetear clave`...), se clasifica como
   `irrelevant_or_low_fit` **aunque tambien mencione taquilla o
   cerradura** — "manual de instrucciones cerradura" no es un lead de
   compra solo porque contenga la palabra "cerradura".
2. **Mueble + cerradura (o mueble + "inteligente/electronico") ->
   `zentry_smart_locker`.** Es la interseccion de interes: quien busca
   esto quiere la solucion completa.
3. **Solo mueble -> `zentry_locker_core`.**
4. **Solo cerradura -> `tukandado_lock_core`.**
5. **Ni mueble ni cerradura, pero con contexto (sector B2B o material) ->
   `mixed_cross_sell`.** Necesita ojo humano.
6. **Nada de lo anterior -> `irrelevant_or_low_fit`.**

Cada resultado incluye siempre un campo `reason` en texto explicando el
porque, y un objeto `signals` con el detalle exacto de que terminos
coincidieron (util para depurar o para que un humano lo revise).

## Vocabulario editable: `config/brand-positioning.json`

La logica de decision vive en el codigo (no cambia sin revisar), pero el
**vocabulario** que alimenta esa logica es un fichero de configuracion
editable sin tocar TypeScript:

- `locker_terms` — taquilla, locker, casillero, vestuario...
- `lock_terms` — cerradura, cerrojo, control de acceso...
- `smart_terms` — inteligente, electronico, digital, smart...
- `b2b_sector_terms` — empresa, gimnasio, colegio, centro deportivo...
  (anade contexto a la razon, no cambia la categoria por si solo)
- `material_terms` — melamina, fenolica, metalica, madera...
  (idem, solo anade contexto)
- `low_fit_terms` — gratis, segunda mano, manual de instrucciones...

Si aparecen keywords reales mal clasificadas, la primera correccion a
intentar es anadir/quitar terminos aqui, no tocar el codigo.

## Quien lo usa

- **SEO Director** — para etiquetar sus acciones agrupadas por marca
  (roadmap; hoy SEO Director no lo usa todavia, ver seccion 8 de su spec).
- **Competitor Intelligence** — clasifica cada keyword detectada en la
  competencia.
- **Content Planner** — decide si una propuesta de contenido es para
  Zentry, Tukandado o mixta.
- **CRO / Landing Reviewer** — adapta las recomendaciones de conversion
  segun la intencion detectada.
- **Growth Director** — agrupa el informe final en secciones "Oportunidades
  Zentry / Tukandado / Mixtas".

## Limitaciones conocidas (v1)

- Es un clasificador basado en reglas/vocabulario, no un modelo de
  lenguaje: puede fallar con frases muy indirectas o ambiguas que no usen
  ninguno de los terminos configurados.
- `b2b_sector_terms` y `material_terms` anaden contexto a la razon pero no
  cambian la categoria salvo en el caso `mixed_cross_sell` — no hay
  deteccion de intencion B2B vs domestica mas alla de esa lista.
- No usa la pagina de destino salvo cuando el agente que llama pasa
  explicitamente `page` a `classifyOpportunity()` (concatena keyword +
  URL antes de clasificar).
