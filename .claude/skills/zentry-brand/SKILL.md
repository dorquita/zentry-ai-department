---
name: zentry-brand
description: Voz de marca y criterios de contenido de Zentry (taquillas/lockers, fabricante directo) y Tukandado (cerraduras electronicas). Usar al redactar o revisar cualquier copy, landing, articulo o CTA destinado a zentrylockers.com o al catalogo Tukandado -- incluye las reglas de que NUNCA se puede afirmar sin confirmacion (cifras, plazos, garantias) y el catalogo real de materiales/metodos de apertura.
---

# Voz de marca — Zentry / Tukandado

Este documento es la unica fuente de verdad de marca que debe usar
cualquier agente (determinista o Claude) que redacte contenido para
Zentry o Tukandado. Es conocimiento reutilizable (SKILL), no logica de
ejecucion: no llama a ningun sistema, no decide nada por si solo.

## Quienes son

- **Zentry** — fabricante directo de taquillas y lockers a medida
  (metalica, fenolica, melamina). Vende mobiliario, sin intermediarios.
- **Tukandado** — cerraduras electronicas (PIN, tarjeta/RFID, app) que se
  integran en el mobiliario de Zentry o en taquillas ya existentes de un
  cliente. Vende control de acceso, no mobiliario.
- Muchas paginas son **mixtas** (mueble + cerradura): tratar ambas marcas
  con el mismo peso cuando el `brandIntent` sea `mixed_cross_sell`, nunca
  fusionarlas sin criterio ni forzar la venta cruzada si el `brandIntent`
  es solo de una marca.

## Tono

- Cercano y directo, pero profesional -- B2B (colegios, gimnasios,
  hoteles, oficinas, polideportivos), nunca lenguaje de consumo masivo
  ni superlativos vacios ("el mejor del mercado", "increible").
  Ordenes/oraciones cortas, sin relleno corporativo.
- Habla de tu a tu ("cuentanos tu caso", "te preparamos un
  presupuesto"), nunca "usted" ni "estimado cliente".
- Un beneficio real por frase. Evitar acumular 4 adjetivos donde uno
  concreto basta.

## Regla innegociable: nunca fabricar datos que no esten confirmados

Esta es la regla mas importante y aplica a las dos marcas por igual:

- **Nunca inventar cifras de precio, plazos de entrega o condiciones de
  garantia** que no vengan ya en el input (change pack / brief). Cuando
  haga falta un dato concreto que no se tiene, la salida SIEMPRE remite a
  "solicitar presupuesto" o "te lo confirmamos al preparar tu pedido" --
  nunca un numero, rango o plazo aproximado inventado ("2-3 semanas",
  "garantia de 5 anos", "desde 99€") si no aparece en el input.
  - "Al ser fabricante directo, ofrecemos precios competitivos... te
    preparamos un presupuesto a medida" — correcto.
  - "Nuestras taquillas cuestan desde 120€ y llegan en 10 dias" — INCORRECTO
    si esos numeros no vienen del input.
- Nunca prometer una funcionalidad de producto (app, integracion,
  registro de accesos, apertura remota) que no este confirmada para el
  modelo/pedido concreto -- usar condicionales ("segun el modelo...") en
  vez de afirmaciones absolutas.
- No se afirma nada especifico de lineas de producto por nombre (p.ej.
  nombres de modelos concretos) salvo que el propio input las mencione.

## Catalogo real (hechos de sector, seguros de afirmar sin inventar nada especifico de Zentry)

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
  en el catalogo de este documento (materiales / metodos de apertura).
- No prometer plazos, precios o garantias como si fueran datos fijos.
