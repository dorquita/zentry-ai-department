# O21 — Bancos de vestuario en producción (cierre)

**Fecha de cierre:** 2026-08-07
**Alcance:** despliegue completo de la gama "Bancos de vestuario" (pino, fenólico, melamina) a producción (zentrylockers.com), replicando lo ya validado en staging. Fase ejecutada en etapas B→J, cada una con dry-run + backup + aprobación explícita de Pau antes de la siguiente.

## Resumen por etapa

### Etapa B — mu-plugin `zentry-hide-prices-guests.php`
Subida manual por FTP (Pau) del archivo real de staging a producción, versión **v1.5.0-O21.1c** (sustituye v1.4.0-O19.5). Backup previo del archivo de producción hecho por Pau antes de subir.
Verificado: producción no cae, versión activa correcta, anónimo sin precio/carrito en taquillas, logueado sigue viendo precios y compra (sobre productos ya existentes, bancos aún no creados en ese momento), sin URLs de staging, sin TEST.php ni duplicados en `mu-plugins/`.

### Etapa C — Categorías WooCommerce
4 categorías creadas (1 padre + 3 hijas):

| ID | Nombre | Slug | Parent |
|---|---|---|---|
| 108 | Bancos de vestuario | bancos-de-vestuario | 0 |
| 109 | Bancos de melamina | bancos-de-melamina | 108 |
| 110 | Bancos de pino | bancos-de-pino | 108 |
| 111 | Bancos fenólicos | bancos-de-fenolicos | 108 |

Backup: `data/o21c-categories-backup-1786129896767.json`. Script: `scripts/o21c-create-bancos-categories.ts`.

### Etapa D — Atributos globales
- **Longitud** (id 9): 1000mm (112), 1500mm (113), 2000mm (114)
- **Cara** (id 10): Doble (116), Única (115)

Incidencia corregida en la misma fase: el término "Única" se creó inicialmente sin tilde ("Unica", bug de escritura del script, no de staging) y se corrigió con un PATCH puntual (`scripts/o21f-fix-unica-term.ts`, seguro porque `count=0` en ese momento), antes de usarlo en ningún producto.

Backup: `data/o21d-attributes-backup-1786132233072.json`. Script: `scripts/o21d-create-bancos-attributes.ts`.

### Etapa E — Media (20 imágenes)
9 principales + 6 detalle/galería + 4 familia + 1 hero recortado 16:9, subidas desde staging (nombres de archivo y alt text SEO conservados). IDs de producción: **1968–1987**.
Mapping completo staging→producción: `data/o21e-media-mapping-1786132769365.json`. Script: `scripts/o21e-upload-bancos-media.ts`.

### Etapa F — 9 productos padre (type: variable, status: publish)
| ID | Slug | SKU |
|---|---|---|
| 1988 | banco-vestuario-pino | VBANPSE |
| 1989 | banco-vestuario-pino-perchero | VBANPPE |
| 1990 | banco-vestuario-pino-zapatero | VBANPPZ |
| 1991 | banco-vestuario-fenolico | VBANFESE |
| 1992 | banco-vestuario-fenolico-perchero | VBANFEPE |
| 1993 | banco-vestuario-fenolico-zapatero | VBANFEPZ |
| 1994 | banco-vestuario-melamina | VBANMESE |
| 1995 | banco-vestuario-melamina-perchero | VBANMEPE |
| 1996 | banco-vestuario-melamina-zapatero | VBANMEPZ |

Sin variaciones en esta etapa. Adapter `woocommerce-production.ts` ampliado (fase O21.5b) para soportar `sku`/`status` en `createProductionVariableProduct()` (antes no existían esos campos).
Backup: `data/o21f-products-backup-*.json`. Resultado: `data/o21f-products-created-1786133549982.json`. Script: `scripts/o21f-create-bancos-parent-products.ts`.

### Etapa G — 45 variaciones
3 variaciones por modelo simple (pino, fenólico, melamina) + 6 por modelo con perchero/zapatero (3 longitudes × 2 caras), IDs **1997–2041**. SKUs, precios, `stock_status`, descripción (medidas) e imagen copiados de staging. Adapter ampliado también para soportar `stockStatus`/`description`/`imageId` en `createProductionVariation()`.
Rango de precios: 92€ (banco melamina simple 1000mm) a 981€ (banco fenólico con zapatero, doble cara, 2000mm).
Badge "AGOTADO" desapareció en los 9 tras crear las variaciones (`stock_status: instock`).
Backup: `data/o21g-variations-backup-*.json`. Resultado: `data/o21g-variations-created-1786134272126.json`. Scripts: `scripts/o21g-create-bancos-variations.ts` + `scripts/o21g-rollback-variations.ts`.

### Etapa H — Landing `/bancos-de-vestuario/`
Página id **2042**, creada como `draft` (contenido remapeado desde staging: 13 imágenes + enlaces a los 9 productos/3 categorías/4 páginas de taquillas, dominio y media IDs remapeados a producción, 0 referencias a staging). **Publicada manualmente por Pau** tras confirmar preview — devuelve 200.
Backup/snapshot: `data/o21h-landing-backup-1786134744799.json`. Script: `scripts/o21h-create-bancos-landing.ts`.

### Etapa I — Menú principal (id 17)
Nuevo ítem **"Bancos de vestuario"** (menu-item id **2044**), `menu_order:3`, justo entre "Taquillas" (order 2) y "Cerraduras" (order 10) — insertado en un hueco libre, **0 ítems existentes desplazados o reordenados**.
Backup: `data/o21i-menu-backup-1786135174666.json`. Scripts: `scripts/o21i-menu-add-bancos-production.ts` + `scripts/o21i-menu-rollback-production.ts`.

### Etapa J — Enlaces internos (11 páginas)
Mismo texto y mecanismo ya aprobados en staging (Fase O21.4), solo remapeando el dominio:
- **Append al final** (5 páginas): taquillas (22), taquillas-por-sector (1636), taquillas-metalicas (108), taquillas-fenolicas (468), taquillas-melamina (470) — "Completa tu vestuario con nuestros bancos de vestuario."
- **Insert antes del CTA final** (6 páginas): taquillas-para-gimnasios (124), -colegios (127), -empresas (129), -centros-deportivos (1820), -industria (1823), -oficinas (1822) — "También podemos completar el proyecto con bancos de vestuario a juego."

Backup (contenido completo previo de las 11): `data/o21j-links-backup-1786135388585.json`. Scripts: `scripts/o21j-add-internal-links-production.ts` + `scripts/o21j-rollback-links-production.ts`.

## QA final verificado (Etapas I/J, tras cierre completo)
- Menú desktop y móvil muestran "Bancos de vestuario": OK
- Landing `/bancos-de-vestuario/` → 200: OK
- 9 productos banco → 200: OK
- Anónimo: precio vacío, sin cantidad ni carrito, en los 9 productos: OK
- CTA "Precio bajo solicitud" / "Solicitar presupuesto de este modelo" / "Iniciar sesión para ver precios", sin ninguna mención a "cerradura": OK
- Logueado (verificado vía REST autenticado como proxy — ver pendiente 2 más abajo): `purchasable:true`, precio y variaciones visibles: OK
- Las 11 páginas de taquillas sin regresión (contenido original intacto + 1 párrafo nuevo cada una, mismo mecanismo append/insert quirúrgico usado en toda la fase): OK
- Producción sana en todo momento (home HTTP 200 verificado tras cada etapa): OK
- Categorías/atributos con `count` correcto en cada etapa (0 antes de tener productos/variaciones, actualizado correctamente después)
- `WORDPRESS_PRODUCTION_APP_PASSWORD`/`WORDPRESS_APP_PASSWORD` nunca expuestos en logs (sanitización ya existente del adapter, sin cambios)

## Disciplina de flags seguida en toda la fase
- Etapas C y D: `.env` editado temporalmente (`PRODUCTION_EXECUTION_ENABLED`/`PRODUCTION_DRAFTS_ENABLED` = true), con backup de `.env` antes y después, revertido a `false` tras cada escritura.
- Etapas E, F, G, H, I, J: flags pasados **inline** en el propio comando (`PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node ...`), **nunca escritos en `.env`** — confirmado tras cada etapa que `.env` seguía en `false`/`false` sin necesidad de backup.

## Rollbacks disponibles

| Etapa | Comando | Nota |
|---|---|---|
| C+D (categorías/atributos) | `npx ts-node scripts/o215-rollback-categories-attributes.ts --categoryIds 108,109,110,111 --attributeIds 9,10 --confirm` | Solo borra lo que tenga `count=0` — bloqueado mientras haya productos/variaciones usándolos |
| E (media) | Sin script de borrado dedicado. IDs **1968–1987** listos para limpieza manual (DELETE REST `force=true`) si se aprueba explícitamente | Ninguna media está asociada a nada fuera de los productos banco |
| F (productos padre) | `npx ts-node scripts/o215-rollback-products.ts --productIds 1988,1989,1990,1991,1992,1993,1994,1995,1996 --confirm` | Mueve a papelera, nunca borra permanentemente |
| G (variaciones) | `npx ts-node scripts/o21g-rollback-variations.ts --variationIds <productId>:<variationId>,... --confirm` | DELETE real (las variaciones no tienen papelera en WooCommerce) |
| H (landing) | `npx ts-node scripts/o215-rollback-landing.ts --pageId 2042 --confirm` | **Ya no aplica tal cual**: el script se niega si el status no es "draft", y la landing ya fue publicada manualmente por Pau — revertir su publicación es una decisión manual desde wp-admin |
| I (menú) | `npx ts-node scripts/o21i-menu-rollback-production.ts --newItemId 2044 --confirm` | Solo borra el ítem nuevo, no toca ningún otro |
| J (enlaces internos) | `npx ts-node scripts/o21j-rollback-links-production.ts --backupFile data/o21j-links-backup-1786135388585.json --confirm` | Restaura el contenido EXACTO previo de las 11 páginas |

## Pendientes menores (no bloqueantes)
1. **Yoast SEO manual no hecho** — meta title/description/schema de la landing y de los 9 productos no se han revisado/rellenado a mano en Yoast todavía.
2. **Validación "logueado" con usuario cliente real pendiente** — todo el QA de "logueado" de esta fase se hizo vía REST autenticado como administrador (proxy razonable de `is_user_logged_in()`, pero no es una sesión de navegador de un cliente real). Si se quiere confirmación al 100%, hace falta repetir la prueba con credenciales de un cliente/comprador de verdad.
3. **Mejora futura de imágenes/3D** — posible ampliación futura (fuera de alcance de O21): renders 3D o fotografía adicional de producto, no evaluado ni planificado todavía.

## Estado final
O21 Bancos de vestuario: **completado en producción**, live, sin cambios pendientes de aprobación. No se han ejecutado cambios adicionales al escribir este informe (documentación pura).
