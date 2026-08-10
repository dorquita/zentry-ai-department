# Visual QA + Optimizacion de Imagen (Fase O12.9)

## Caso real analizado

Draft `1959` (staging), imagen hero `media 1960`:

| | |
|---|---|
| Formato original | PNG |
| Peso original | 2,072,534 bytes (~2024KB / 2.07MB) |
| Dimensiones | 1536x1024 |
| Alt text | "Taquillas escolares — imagen principal" (presente y correcto) |

## Recomendacion

**Si, se recomienda WebP.** Un PNG fotografico de ~2MB para una imagen
hero de landing es excesivo para web (afecta LCP/Core Web Vitals y el
tiempo de carga en movil). Convertido con `sharp` a WebP calidad 80:

| | |
|---|---|
| Peso WebP | 67,616 bytes (~66KB) |
| Reduccion | **96.7%** |
| Dimensiones | 1536x1024 (identicas, sin recorte) |

**Peso objetivo recomendado:** <250KB para una imagen hero WebP a esta
resolucion es un objetivo comodo; el resultado real (66KB) queda muy
por debajo, con margen de sobra incluso subiendo la calidad si hiciera
falta mas nitidez.

## Que se subio (Fase O12.9, ya ejecutado)

- Nueva media en la Media Library de staging: `wordpressMediaId 1962`,
  `taquillas-escolares-hero-zentry.webp`, mismo alt text que el
  original.
- El PNG original (`media 1960`) **no se toco ni se borro**.
- El draft `1959` **no se modifico** — sigue apuntando al PNG. La
  sustitucion es un paso deliberadamente separado (ver abajo).
- Registro: `data/image-optimizations.jsonl`,
  `optimizationId: img-opt-8883bed5-4625-4660-9394-3f8b655c199d`,
  `status: "uploaded"` (no `"applied"` -- eso solo pasa cuando se
  ejecuta la sustitucion).

## Sustitucion (construida, NO ejecutada en esta fase)

`npm run drafts:swap-image -- --pageId 1959 --optimizationId img-opt-8883bed5-4625-4660-9394-3f8b655c199d`

Reemplaza, dentro del draft, el bloque `wp:image` que apunta al media
original por uno que apunta al WebP nuevo (mismo alt text, misma clase
`hero-image`). Guarda un snapshot previo completo en
`data/draft-image-insertions.jsonl` (mismo registro que
`insert-hero-image-into-draft.ts`) para poder revertir con
`npm run drafts:rollback-image-insertion`. **No se ha ejecutado** --
exige confirmacion explicita del cliente antes de correrlo.

## Visual QA automatico (Fase O12.9, ya integrado en `npm run staging:qa` / `growth:daily`)

`src/agents/staging-qa-agent.ts` ahora detecta el bloque de imagen hero
(marcador `hero-image`) en cada draft verificado y revisa, via la
Media Library (solo lectura):

- **Presencia** de imagen hero.
- **Alt text** presente/ausente.
- **Peso**: warning (no bloqueante) si > 500KB.
- **Formato**: warning (no bloqueante) si no es WebP.

Nunca bloquea el borrador (`overallPass`) -- son mejoras de calidad, no
errores funcionales, mismo criterio que el resto de warnings del
proyecto desde la Fase O12.2.
