# SEO Specialist — analisis seo-specialist-2026-08-17T20-19-33-226Z-x43kny

- **Generado:** 2026-08-17T20:26:31.061Z
- **runId de datos analizados:** `seo-watcher-2026-08-17T201818Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 2 aviso(s) de auditoria.

### Resumen ejecutivo

Con datos live de Search Console (0h de antiguedad) sobre 36 jobs del run seo-watcher-2026-08-17T201818Z, el hallazgo mas critico es una canibalizacion de 'melamina' ya documentada en el catalogo de clusters (decision O29.1) pero que sigue sin resolverse en el backlog: 4 actionItems de las keywords genericas 'taquillas melamina'/'taquillas de melamina' apuntan a /taquillas-melamina-fenolico/ cuando el cluster catalog indica explicitamente que deben cerrarse via script y quedarse solo en /taquillas-melamina/. En paralelo, dos keywords de cerraduras (centros deportivos y gimnasios) apuntan a /cerraduras/, una URL que el propio catalogo marca en papelera con redireccion 301 desde O22 -- ejecutar esas tareas tal cual seria un error tecnico. Hay 7 quick wins reales con posiciones entre 10.6 y 28.7 que solo requieren refuerzo on-page. Cuatro clusters marcados new_page_candidate (metalicas, universidades, vestuarios, inteligentes-general) ya tienen staging aprobado visualmente en su mayoria y representan gaps de contenido listos para publicar. Tres keywords del catalogo estatico (taquillas para gimnasios, digitalizacion de taquillas, lockers inteligentes) no tienen cluster ni pagina asociada pese a ser de prioridad alta/media.

### Findings (8)

- [cannibalization] (evidence) Las keywords genericas 'taquillas melamina' y 'taquillas de melamina' aparecen en el backlog apuntando tanto a /taquillas-melamina/ (correcto segun cluster taquillas_melamina) como a /taquillas-melamina-fenolico/ (mal enrutado segun el propio cluster taquillas_melamina_fenolico, que documenta la decision O29.1 de Pau: la keyword generica ya NO debe apuntar a esa URL). El catalogo ya identifica estos casos como 'mal enrutados' y senala un script de resolucion existente que aparentemente no se ha aplicado sobre estos actionItems concretos.
- [technical] (evidence) El actionItem de 'cerraduras inteligentes para centros deportivos' apunta a https://zentrylockers.com/cerraduras/, pero el cluster correspondiente (accion 'reject') documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/. Ejecutar la optimizacion on-page tal como esta descrita en el actionItem no tiene sentido tecnico sobre una pagina eliminada.
- [keyword_strategy] (inference) La keyword 'cerraduras sostenibles para gimnasios' (dos actionItems, apuntando a /cerraduras/ y a /cerraduras-inteligentes-taquillas/) no aparece en ningun matchPattern del catalogo de clusters -- es una keyword huerfana sin decision de intencion documentada, y uno de sus dos destinos actuales (/cerraduras/) es la misma URL en papelera senalada en F2.
- [content] (evidence) Un numero elevado de actionItems con volumen de impresiones relevante (50-86 impresiones) muestran CTR actual del 0.00% segun su propio rationale/action, lo que sugiere un problema sistemico de meta title/description poco atractivos en varias paginas de producto y sector, no un caso aislado.
- [content] (evidence) Cuatro clusters marcados como 'new_page_candidate' (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios, taquillas_inteligentes_general) representan huecos de cobertura tematica reales; tres de ellos ya tienen su pagina en staging visualmente aprobada (2105, 2110, 2104) y solo falta publicarla en produccion, mientras que la cuarta (2103, inteligentes-general) aun esta pendiente de aprobacion visual final.
- [internal_linking] (evidence) El cluster de terminos comerciales genericos ('comprar taquillas', 'soluciones de taquillas') fue pospuesto explicitamente porque no tiene angulo de producto/sector propio y arriesga canibalizar paginas existentes sin aportar valor; el catalogo recomienda en su lugar mejorar CTAs y enlazado interno en paginas ya existentes en vez de crear paginas nuevas.
- [content] (inference) Las keywords objetivo 'taquillas para gimnasios' (comercial, prioridad alta) y 'digitalizacion de taquillas' (informacional, prioridad media) figuran en el catalogo estatico de keywords pero no tienen ningun cluster ni pagina asociada en el catalogo de clusters, a diferencia del resto de keywords objetivo que si estan cubiertas.
- [keyword_strategy] (inference) La keyword objetivo 'lockers inteligentes' (comercial, prioridad alta) no aparece literalmente en los matchPatterns de ningun cluster; el mas cercano semanticamente es taquillas_inteligentes_general ('taquillas inteligentes'/'taquilla inteligente'), pero si esa pagina no incorpora explicitamente la variante 'lockers' podria no capturar bien esta busqueda.

### Oportunidades (18, prioridad: 3 alta / 14 media / 1 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Optimizar on-page (H1/H2, profundidad de texto, enlazado interno, meta title/description) para pasar de posicion 10.6 a top 10.
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Reforzar contenido y metas de la misma pagina para capturar tambien esta variante (posicion actual 17.1), ademas de mejorar CTR (0.00% actual).
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Optimizar on-page y metas para esta variante 'electronicas' sobre la misma pagina que ya cubre 'inteligentes' (accion ya consolidada en el cluster).
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar contenido en H1/H2 y reescribir meta title/description para mejorar posicion (25.1) y CTR (0.00%).
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizar on-page para esta variante long-tail sobre la pagina de melamina ya asignada por el cluster.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido y metas en la pagina correcta segun el cluster (update_existing_page), aprovechando el recommendedTitle/meta ya definidos en el catalogo.
- [high] (cannibalization, evidence) "taquillas melamina / taquillas de melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: No optimizar estos actionItems tal cual: cerrarlos/reenrutarlos via el script de resolucion ya referenciado en el catalogo (scripts/o291-resolve-melamina-cannibalization.ts), dejando que la keyword generica de melamina siga apuntando unicamente a /taquillas-melamina/.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No ejecutar la optimizacion sobre /cerraduras/ (en papelera, redirige 301 a /cerraduras-para-taquillas/). Decidir con Pau si el objetivo correcto es /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (/cerraduras-inteligentes-taquillas/) antes de invertir esfuerzo.
- [medium] (future_opportunity, evidence) "taquillas fenólicas en palencia" — https://zentrylockers.com/taquillas-fenolicas/: Tratar esta y 'fabricante de taquillas fenólicas en badajoz' como parte del cluster generico de fenolicas (sin crear contenido geografico especifico, segun el catalogo), reforzando la landing general y sus metas.
- [medium] (content_gap, evidence) "taquillas metalicas": Publicar en produccion la pagina de staging ya aprobada visualmente (2105) para el tercer material del catalogo de producto.
- [medium] (content_gap, evidence) "taquillas universidad": Publicar en produccion la pagina de staging ya aprobada visualmente (2110) para el sector universidades.
- [medium] (content_gap, evidence) "taquillas vestuarios": Publicar en produccion la pagina de staging ya aprobada visualmente (2104), diferenciada de /bancos-de-vestuario/.
- [medium] (content_gap, evidence) "taquillas inteligentes": Completar la aprobacion visual final del staging 2103 (solucion general) verificando que no canibaliza el cluster de cerraduras inteligentes (1865/2096) antes de publicar.
- [low] (internal_linking, evidence) "comprar taquillas / soluciones de taquillas": No avanzar las paginas de staging (2101/2102) a produccion; en su lugar, mejorar CTAs y enlazado interno hacia paginas de sector/material ya existentes que capturen esta intencion transaccional generica.
- [medium] (future_opportunity, evidence) "taquilla para el personal" — https://zentrylockers.com/taquillas-para-empresas/: Crear o reforzar contenido de soporte para esta variante dentro de la pagina ya asignada por el cluster (empresas/personal), junto con mejora de CTR.
- [medium] (future_opportunity, evidence) "taquillas escolares" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar la misma pagina que ya cubre 'taquillas colegios' (sinonimo de intencion segun el cluster) con contenido adicional y mejora de CTR.
- [medium] (future_opportunity, evidence) "taquillas melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido y metas de la pagina general de melamina (recommendedTitle/meta ya definidos en el cluster) para capturar mejor esta keyword generica de alto volumen.

### Problemas tecnicos (1)

- [high] https://zentrylockers.com/cerraduras/: Pagina en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/, pero sigue apareciendo como pagina de destino en el backlog de acciones para 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios'. Ejecutar las tareas de optimizacion on-page tal cual no tiene efecto real.

### Huecos de contenido (7)

- Taquillas metalicas (tercer material del catalogo de producto) (keyword relacionada: "taquillas metalicas"): Cluster new_page_candidate sin pagina de produccion; staging 2105 ya creada y aprobada visualmente, coincide con keyword objetivo del catalogo estatico (prioridad media, comercial).
- Taquillas para universidades (sector sin pagina propia) (keyword relacionada: "taquillas universidad"): Cluster new_page_candidate sin pagina de produccion equivalente confirmada; staging 2110 ya aprobada visualmente.
- Taquillas para vestuarios (distinto de bancos de vestuario) (keyword relacionada: "taquillas vestuarios"): Cluster new_page_candidate sin pagina de produccion; staging 2104 ya aprobada visualmente.
- Solucion general de taquillas inteligentes (mueble + cerradura + control de acceso) (keyword relacionada: "taquillas inteligentes"): Cluster new_page_candidate distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); staging 2103 corregida en O28.6 pero pendiente de aprobacion visual real, riesgo de canibalizacion documentado si se fusiona sin decision explicita.
- Taquillas para gimnasios (sector sin cluster asociado) (keyword relacionada: "taquillas para gimnasios"): Keyword objetivo comercial de prioridad alta en el catalogo estatico, pero sin cluster ni pagina asociada en el catalogo de clusters -- posible hueco estrategico no capturado todavia por el pipeline de clustering.
- Digitalizacion de taquillas (contenido informativo) (keyword relacionada: "digitalizacion de taquillas"): Keyword objetivo informacional de prioridad media en el catalogo estatico, sin cluster ni pagina asociada -- podria requerir un articulo o pieza de contenido informativo dedicado.
- Lockers inteligentes (variante terminologica de taquillas inteligentes) (keyword relacionada: "lockers inteligentes"): Keyword objetivo comercial de prioridad alta, semanticamente cercana al cluster taquillas_inteligentes_general pero no incluida literalmente en sus matchPatterns; conviene revisar si la futura pagina general debe incorporar explicitamente el termino 'lockers'.

### Enlazado interno recomendado (3)

- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas"): Ambas paginas comparten material base pero atacan intenciones diferenciadas (generico vs. combinacion especifica); un enlace claro desde la pagina general ayuda a usuarios y motores a distinguir la variante correcta y reduce el riesgo de que el trafico generico siga cayendo por error en la pagina especifica.
- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> https://zentrylockers.com/cerraduras-para-taquillas/ ("ver catalogo de cerraduras inteligentes ARES, ORBIS, BOXIS, NEO"): El propio cluster distingue esta pagina informativa de /cerraduras-para-taquillas/ (catalogo comercial); enlazar desde la version informativa hacia la comercial completa el funnel informativo-transaccional que el catalogo ya reconoce como intencionado.
- https://zentrylockers.com/taquillas-para-colegios/ -> https://zentrylockers.com/taquillas-melamina/ ("taquillas de melamina para colegios"): El sector colegios es un comprador tipico de taquillas de material melamina (resistente y economico); un enlace tematico entre ambas paginas puede reforzar relevancia cruzada y ayudar a ambas keywords, que actualmente estan en posiciones cercanas (25.1 y 28.7).

### Acciones priorizadas (7)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Cerrar/reenrutar los actionItems de 'melamina' mal enrutados a /taquillas-melamina-fenolico/ via el script de resolucion existente | high | low | high |
| 2 | Decidir y corregir el destino real de 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios' (evitar /cerraduras/ en papelera) | high | medium | high |
| 3 | Ejecutar los quick wins de on-page en keywords cerca de top10 (cerraduras inteligentes taquillas, hospitales, cerraduras electronicas taquillas, colegios, melamina/vestuarios) | high | medium | medium |
| 4 | Reescribir metas para reducir el CTR 0.00% en paginas con impresiones altas (melamina generica, fenolicas, cerraduras) | medium | medium | medium |
| 5 | Publicar en produccion las paginas nuevas ya aprobadas en staging (metalicas, universidades, vestuarios) para cerrar gaps de contenido reales | medium | low | high |
| 6 | Revisar y asignar cluster/pagina a las keywords objetivo huerfanas (taquillas para gimnasios, digitalizacion de taquillas, lockers inteligentes) | medium | low | medium |
| 7 | Mejorar enlazado interno entre paginas de material/sector relacionadas en vez de crear paginas para terminos genericos pospuestos | low | low | medium |

### Desconocidos (5)

- No se dispone de cifras exactas de clics ni de CTR numerico mas alla del indicador '0.00%' mencionado en el rationale de los actionItems con flag low_ctr; no se puede cuantificar el impacto real de una mejora de metas.
- No se conoce el estado final de aprobacion visual de la pagina staging 2103 (taquillas_inteligentes_general) mas alla de 'pendiente de aprobacion visual real'.
- No hay datos de Search Console para las paginas candidatas aun no publicadas (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios), por lo que no se puede estimar volumen de busqueda o dificultad una vez publicadas.
- No se ha leido el contenido completo de los informes de SEO Watcher (reports/seo/seo-watcher-2026-08-17.md) ni SEO Director (reports/seo-director/seo-director-2026-08-17.md) referenciados en dataAvailability -- solo se conocen sus rutas, no su contenido.
- No se sabe si el script scripts/o291-resolve-melamina-cannibalization.ts mencionado en el catalogo de clusters ya se ha ejecutado sobre los actionItems actuales o sigue pendiente.

**⚠️ Auditoria: 2 aviso(s) para revision humana:**
- Evidencia "e6" cita la keyword "taquillas melamina-fenolico", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "e34" cita la keyword "comprar taquillas / soluciones de taquillas", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
