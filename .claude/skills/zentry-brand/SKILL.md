---
name: zentry-brand
description: Voz de marca y criterios de contenido de Zentry (taquillas/lockers) y Tukandado (cerraduras electronicas). Usar al redactar o revisar cualquier copy, landing, articulo o CTA destinado a zentrylockers.com o al catalogo Tukandado -- incluye las reglas de que NUNCA se puede afirmar sin confirmacion (cifras, plazos, garantias, y afirmaciones de negocio como "fabricante directo"), el catalogo real de materiales/metodos de apertura, y las instrucciones de tono.
---

# Voz de marca — Zentry / Tukandado

Este documento es la unica fuente de verdad de marca que debe usar
cualquier agente (determinista o Claude) que redacte contenido para
Zentry o Tukandado. Es conocimiento reutilizable (SKILL), no logica de
ejecucion: no llama a ningun sistema, no decide nada por si solo.

Esta separado deliberadamente en tres tipos de contenido, que NO deben
mezclarse: (1) **hechos de negocio confirmados** (catalogo real de
materiales/metodos de apertura -- seguro afirmarlos siempre), (2)
**afirmaciones que requieren confirmacion de negocio pagina por pagina**
(p.ej. "fabricante directo" -- NO son un hecho general que se pueda
asumir siempre, solo se usan si el input de esa pagina concreta ya las
confirma), y (3) **instrucciones de tono** (como se escribe, no que se
afirma).

## Quienes son

- **Zentry** — fabrica taquillas y lockers a medida (metalica, fenolica,
  melamina). Vende mobiliario.
- **Tukandado** — cerraduras electronicas (PIN, tarjeta/RFID, app) que se
  integran en el mobiliario de Zentry o en taquillas ya existentes de un
  cliente. Vende control de acceso, no mobiliario.
- Muchas paginas son **mixtas** (mueble + cerradura): tratar ambas marcas
  con el mismo peso cuando el `brandIntent` sea `mixed_cross_sell`, nunca
  fusionarlas sin criterio ni forzar la venta cruzada si el `brandIntent`
  es solo de una marca.

## Hechos de negocio CONFIRMADOS (catalogo real, seguro afirmarlos)

Son propiedades tecnicas generales del sector (no cifras/plazos/
garantias propias de Zentry sin confirmar) -- se pueden afirmar
directamente en cualquier pagina relevante, sin necesitar que el input
de esa pagina concreta las repita.

**Materiales de taquillas:**
- **Melamina** — acabado calido tipo madera, buena relacion
  calidad-precio, resistencia media a la humedad. Oficinas, colegios,
  vestuarios secos.
- **Fenolica** — maxima resistencia a la humedad y al impacto, acabado
  mas tecnico/industrial, coste superior. Piscinas, duchas, gimnasios,
  polideportivos.
- **Metalica** — maxima resistencia a impactos y uso intensivo, acabado
  industrial, requiere tratamiento anticorrosion en entornos humedos.
  Gimnasios, industria, colegios de alto trafico.

**Metodos de apertura (Tukandado):**
- Mecanica (llave/candado fisico) — sencilla, sin mantenimiento
  electronico, sin registro de uso.
- Electronica: PIN, tarjeta/RFID, app segun modelo -- sin llave fisica
  que perder o duplicar; los modelos con conectividad pueden registrar
  quien abrio y cuando.

## Afirmaciones que REQUIEREN CONFIRMACION DE NEGOCIO (no son hechos generales)

A diferencia del catalogo de arriba, estas frases NO se afirman por
defecto en ninguna pagina -- usalas UNICAMENTE si el input estructurado
de esa pagina concreta (change pack / `currentAssumptions` /
`existingFaqs`) ya las contiene. Si el input no las respalda, evita la
afirmacion (usa una alternativa neutra o remite a "solicitar
presupuesto") en vez de asumir que son ciertas para todas las paginas.
Esta lista existe porque una version anterior de esta skill presentaba
"fabricante directo" como un hecho de marca siempre seguro de afirmar, y
eso genero un falso negativo real en la auditoria de datos fabricados
(ver `test/landing-architect-comparison.test.ts`, caso marcado
`REGRESION`):

- **"Fabricante directo" / "sin intermediarios" / "venta directa"** --
  es una afirmacion de modelo de negocio, no una propiedad tecnica de
  producto. No la repitas en toda pagina por rutina.
- **Existencia de garantia** ("cuenta con garantia de fabricante",
  "incluye garantia") -- solo si el input de esa pagina confirma que hay
  garantia (y sin inventar el plazo/condiciones si no vienen dadas).
- **Velocidad de entrega en terminos absolutos** ("entrega rapida",
  "plazos cortos") sin una cifra del input que lo respalde -- distinto
  de remitir a "te confirmamos el plazo con tu presupuesto", que si esta
  permitido siempre (ver regla de abajo).
- Cualquier funcionalidad de producto presentada como universal ("todas
  las taquillas incluyen app") en vez de condicional ("segun el
  modelo...").

## Regla innegociable: nunca fabricar datos ni afirmaciones sin respaldo

Esta es la regla mas importante y aplica a las dos marcas por igual, y
cubre tanto CIFRAS como afirmaciones CUALITATIVAS sin numero (ver
`src/core/landing-architect-comparison.ts`, categorias de
`auditV2OutputForFabrication`: garantia, precio, plazo de entrega,
fabricante directo/sin intermediarios, funcionalidad de producto):

- **Nunca inventar cifras de precio, plazos de entrega o condiciones de
  garantia** que no vengan ya en el input (change pack / brief). Cuando
  haga falta un dato concreto que no se tiene, la salida SIEMPRE remite a
  "solicitar presupuesto" o "te lo confirmamos al preparar tu pedido" --
  nunca un numero, rango o plazo aproximado inventado ("2-3 semanas",
  "garantia de 5 anos", "desde 99€") si no aparece en el input.
- **Tampoco afirmar CUALITATIVAMENTE** algo de la lista de "requieren
  confirmacion de negocio" de arriba sin que el input lo respalde --
  "cuentan con garantia de fabricante" es tan fabricado como "garantia
  de 5 años" si el input marca la garantia como pendiente de confirmar.
  - "Al ser fabricante directo, ofrecemos precios competitivos... te
    preparamos un presupuesto a medida" — correcto SOLO si el input de
    esa pagina ya confirma que es fabricante directo; si no, usa
    "Preparamos un presupuesto a medida segun tu pedido, sin
    compromiso" (sin la afirmacion de "fabricante directo").
  - "Nuestras taquillas cuestan desde 120€ y llegan en 10 dias" —
    INCORRECTO si esos numeros no vienen del input.
- Nunca prometer una funcionalidad de producto (app, integracion,
  registro de accesos, apertura remota) que no este confirmada para el
  modelo/pedido concreto -- usar condicionales ("segun el modelo...") en
  vez de afirmaciones absolutas.
- No se afirma nada especifico de lineas de producto por nombre (p.ej.
  nombres de modelos concretos) salvo que el propio input las mencione.

## Tono (como se escribe, no que se afirma)

- Cercano y directo, pero profesional -- B2B (colegios, gimnasios,
  hoteles, oficinas, polideportivos), nunca lenguaje de consumo masivo
  ni superlativos vacios ("el mejor del mercado", "increible").
  Ordenes/oraciones cortas, sin relleno corporativo.
- Habla de tu a tu ("cuentanos tu caso", "te preparamos un
  presupuesto"), nunca "usted" ni "estimado cliente".
- Un beneficio real por frase. Evitar acumular 4 adjetivos donde uno
  concreto basta.

## Estructura y jerarquia visual esperada en una landing

- Un unico H1 (el headline del hero).
- CTA principal visible above the fold, dentro del bloque hero.
- Beneficios y materiales en bloques/columnas/cards, nunca solo texto
  corrido.
- Al menos una tabla comparativa quando el contenido compara opciones
  (materiales, mecanica vs electronica).
- Un CTA final claro, coherente con el CTA principal (mismo objetivo, no
  un segundo mensaje distinto).
- Estructura pensada para mobile-first: bloques cortos, sin parrafos de
  mas de 3-4 lineas, headings que funcionen igual de bien en una columna
  estrecha.

## CTAs tipicos (reutilizables, adaptar segun el tema)

- "Solicitar presupuesto sin compromiso" (generico, mobiliario).
- "Solicitar informacion o demo" (temas de control de acceso/cerraduras
  inteligentes).
- Nunca un CTA que prometa una accion que el sitio no puede ejecutar
  (ej. "compra ahora" cuando no hay checkout online activo).

## Que NO hacer

- No usar superlativos sin base ("el numero uno", "lider del sector").
- No mezclar Zentry y Tukandado sin que el `brandIntent` del input lo
  pida.
- No dejar una seccion en blanco o con relleno vacio tipo "cuentanos tu
  caso" cuando el heading pide informacion real de producto disponible
  en el catalogo CONFIRMADO de este documento (materiales / metodos de
  apertura).
- No prometer plazos, precios o garantias como si fueran datos fijos.
- No afirmar "fabricante directo"/"sin intermediarios" ni ninguna otra
  frase de la lista "requieren confirmacion de negocio" como si fuera un
  hecho general -- solo si el input de esa pagina concreta ya lo
  confirma.
