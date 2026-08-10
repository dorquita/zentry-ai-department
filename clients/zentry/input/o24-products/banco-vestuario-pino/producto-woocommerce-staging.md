# Fuente: ficha real de WooCommerce (staging), producto id 1988

**Cómo se obtuvo:** lectura de solo lectura vía REST API autenticada contra `staging.zentrylockers.com` (`GET /wp-json/wc/v3/products/1988`), el **2026-08-09**, dentro de la Fase O24.1. No es una foto ni un PDF — es texto de la ficha de producto ya publicada, tratado como fuente **verificada** porque es la descripción oficial que Zentry ya usa de cara al cliente (Fase O21, `docs/o21-bancos-vestuario-production-closure.md`).

- **ID staging:** 1988
- **SKU:** VBANPSE
- **Slug:** `banco-vestuario-pino`
- **Status:** publish

## Short description (verificado)

> Banco de vestuario pino, modelo sencillo.

## Description completa (verificado)

> Banco de vestuario pino Zentry. Fabricado en madera de pino de Suecia cepillado, con listones de 25 mm de espesor, cantos biselados y barnizados con poliuretano. Estructura de patas independientes en tubo de acero de 30x30x1,5 mm, soldada y pintada en epoxi (60 micras). Tacos antideslizantes y herrajes de acero inoxidable.
>
> Modelo sin zapatero, con refuerzo/listón metálico de unión entre patas.
>
> Disponible en longitudes de 1000, 1500 y 2000 mm. Recomendado para vestuarios de gimnasios, colegios, empresas y centros deportivos. Combina con las taquillas Zentry del mismo acabado.

## Atributo WooCommerce (verificado)

- **Longitud:** 1000mm / 1500mm / 2000mm (variaciones reales del producto)

## Extracción de hechos verificados (para el Agente 2 / Agente 5)

- Madera: pino de Suecia, cepillado.
- Grosor del listón del asiento: **25 mm** (dato exacto, no inferido).
- Acabado del listón: cantos biselados, barniz de poliuretano.
- Patas: tubo de acero de **30×30×1,5 mm**, independientes (no un marco continuo), soldadas, pintura epoxi de 60 micras.
- Tacos antideslizantes + herrajes de acero inoxidable.
- **Diferencia real frente al prototipo JS de O23:** el modelo simple lleva un "refuerzo/listón metálico de unión entre patas" — el prototipo paramétrico de O23 (`assets/js/configurator.js` del plugin `zentry-3d-configurator`) NO modela esa pieza todavía. Anotar en `geometry-plan.json` cuando se rellene.
- Longitudes reales: 1000/1500/2000mm (coincide con las opciones ya usadas en el configurador de O23).

## Lo que esta ficha NO dice (sigue pendiente)

- Profundidad del banco (mm).
- Altura total del banco (mm).
- Separación entre patas / posición exacta a lo largo de la longitud.
- Color exacto del barniz (poliuretano "natural" es lo habitual pero no está explícito aquí).
