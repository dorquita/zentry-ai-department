# SEO Specialist — analisis seo-specialist-2026-08-16T18-53-36-569Z-tctnce

- **Generado:** 2026-08-16T18:58:48.388Z
- **runId de datos analizados:** `seo-watcher-2026-08-16T185149Z`
- **actionItems en contexto:** 18
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 3 aviso(s) de auditoria.

### Resumen ejecutivo

Datos live de esta pasada (Search Console leido hace 0h, run seo-watcher-2026-08-16T185149Z, 35 jobs). El backlog trae 18 actionItems reales, cruzados contra 10 target keywords y 20 clusters ya decididos. Hay 6 quick wins listos para ejecutar en paginas ya indexadas entre posicion 17 y 28.8 (cerraduras-inteligentes-taquillas, taquillas-melamina, taquillas-para-colegios, taquillas-para-hospitales). Pero hay dos problemas de higiene de datos que deben resolverse antes de ejecutar nada mas: (1) al menos 2 actionItems (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) siguen recomendando trabajo on-page sobre https://zentrylockers.com/cerraduras/, una pagina que el propio catalogo de clusters marca como en papelera desde O22 con redireccion 301 a /cerraduras-para-taquillas/ -- ejecutarlo tal cual desperdiciaria WordPress; (2) 2 actionItems de keywords genericas de melamina siguen apuntando a /taquillas-melamina-fenolico/ pese a que el catalogo documenta esa cannibalizacion como YA resuelta por Pau (decision O29.1) y con un script dedicado para cerrarlos. Ademas, practicamente todos los actionItems con kind low_ctr reportan CTR real de 0.00% pese a tener impresiones, lo que apunta a un problema sistemico de meta titles/descriptions, no solo casos aislados. Por el lado de contenido, 4 clusters marcados new_page_candidate (universidades, metalicas, vestuarios, taquillas inteligentes solucion general) ya tienen paginas de staging aprobadas visualmente y representan huecos de contenido reales pendientes de publicar. Finalmente, la keyword "cerraduras sostenibles para gimnasios" no esta cubierta por ningun cluster del catalogo y aparece apuntando a dos paginas distintas, senal de que falta una decision de enrutado documentada.

### Findings (6)

- [technical] (evidence) El actionItem para "cerraduras inteligentes para centros deportivos" (y tambien "cerraduras sostenibles para gimnasios") recomienda reforzar/reescribir meta title-description en https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/, y que la decision correcta del cluster es "reject" hasta que Pau apruebe un nuevo objetivo (2060 o 1865). Ejecutar la accion tal cual desperdicia trabajo de WordPress sobre una pagina muerta.
- [cannibalization] (evidence) Dos actionItems ("taquillas melamina" y "taquillas de melamina") apuntan a https://zentrylockers.com/taquillas-melamina-fenolico/ usando la keyword generica de melamina, pero el catalogo de clusters documenta explicitamente (decision O29.1, Pau) que esta cannibalizacion ya esta resuelta: la keyword generica debe ir a /taquillas-melamina/ y cualquier actionId historico apuntando a la pagina de combinacion melamina-fenolico se considera mal enrutado y se cierra via scripts/o291-resolve-melamina-cannibalization.ts.
- [content] (evidence) 4 clusters del catalogo (taquillas_universidad, taquillas_metalicas, taquillas_vestuarios, taquillas_inteligentes_general) tienen action "new_page_candidate" con paginas de staging ya creadas y aprobadas visualmente, pero ninguna aparece todavia como pagina real en los actionItems de este run -- son huecos de contenido ya validados y pendientes de publicar.
- [keyword_strategy] (inference) La keyword "cerraduras sostenibles para gimnasios" aparece dos veces en actionItems apuntando a dos paginas distintas (/cerraduras-inteligentes-taquillas/ y /cerraduras/, esta ultima ya senalada como obsoleta en f1) y no coincide con ningun matchPattern del catalogo de clusters -- no hay una decision de enrutado documentada para ella, lo que genera riesgo de duplicar esfuerzo o de ejecutar sobre la pagina equivocada sin control.
- [technical] (evidence) Multiples actionItems con kind low_ctr reportan explicitamente CTR actual de 0.00% pese a tener impresiones reales (40, 47, 72, 33, 27 impresiones entre otros) en paginas de sector/producto ya indexadas -- patron sistemico de meta titles/descriptions poco atractivos, no un caso aislado de una sola pagina.
- [keyword_strategy] (evidence) Tres keywords de prioridad alta/media en el catalogo de negocio ("lockers inteligentes", "taquillas para gimnasios", "digitalizacion de taquillas") no aparecen en ningun actionItem de este run -- no hay senal de posicion/impresiones reciente de Search Console para ellas pese a su prioridad declarada.

### Oportunidades (10, prioridad: 3 alta / 7 media / 0 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizar on-page (H1/H2, profundidad de texto, enlazado interno, meta title/description) para pasar de posicion 28.8 a top 10; CTR actual 0.00% pese a 72 impresiones.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Optimizar on-page y meta title/description para pasar de posicion 25.1 a top 10; CTR actual 0.00% pese a 40 impresiones.
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizar on-page para pasar de posicion 28.0 a top 10, reforzando el contenido de vestuarios dentro de la pagina de melamina.
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Optimizar on-page y meta title/description para pasar de posicion 24.4 a top 10; CTR actual 0.00% pese a 26 impresiones.
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Optimizar on-page y meta title/description para pasar de posicion 17.0 a top 10; CTR actual 0.00% pese a 20 impresiones.
- [high] (cannibalization, evidence) "taquillas melamina / taquillas de melamina (genericas mal enrutadas)" — https://zentrylockers.com/taquillas-melamina-fenolico/: No ejecutar el on-page sugerido en /taquillas-melamina-fenolico/ para estas keywords genericas; cerrarlas via el script existente scripts/o291-resolve-melamina-cannibalization.ts y reenrutar el interes real hacia /taquillas-melamina/.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No ejecutar la accion tal cual sobre /cerraduras/ (papelera, redirige a /cerraduras-para-taquillas/). Escalar a Pau para decidir si el objetivo real es /cerraduras-para-taquillas/ (2060) o el cluster de cerraduras inteligentes (1865) antes de invertir trabajo de WordPress.
- [medium] (technical, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Auditar y reescribir meta titles/descriptions de las paginas con impresiones pero 0% CTR, empezando por esta y extendiendo el mismo diagnostico a cerraduras-inteligentes-taquillas, taquillas-melamina, taquillas-para-empresas y taquillas-fenolicas (mismo patron); valorar datos estructurados/rich snippets.
- [medium] (content_gap, evidence) "taquillas universidad / taquillas metalicas / taquillas vestuarios / taquillas inteligentes": Avanzar a produccion las 4 paginas de staging ya aprobadas visualmente para los clusters new_page_candidate (universidad, metalicas, vestuarios, taquillas inteligentes general) para capturar demanda ya validada.

### Problemas tecnicos (2)

- [high] https://zentrylockers.com/cerraduras/: Pagina en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/, pero sigue siendo el targetUrl de un cluster con action "reject" y de al menos 2 actionItems activos (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) que recomiendan trabajo on-page sobre ella.
- [medium] https://zentrylockers.com/taquillas-para-colegios/: Patron sistemico de CTR actual 0.00% pese a impresiones reales en al menos 6 paginas distintas del backlog (esta pagina, cerraduras-inteligentes-taquillas, taquillas-melamina, taquillas-para-empresas, taquillas-fenolicas) -- sintoma de meta titles/descriptions poco atractivos o ausencia de rich snippets, no un caso aislado.

### Huecos de contenido (4)

- Taquillas para universidades (keyword relacionada: "taquillas universidad"): Cluster taquillas_universidad, action new_page_candidate, sin pagina de produccion equivalente confirmada; staging 2110 ya creada y aprobada visualmente.
- Taquillas metalicas (keyword relacionada: "taquillas metalicas"): Cluster taquillas_metalicas, action new_page_candidate: tercer material del catalogo (junto a melamina/fenolica) sin pagina propia; staging 2105 aprobada visualmente. Coincide ademas con una target keyword de prioridad media en el catalogo de negocio.
- Taquillas para vestuarios (keyword relacionada: "taquillas vestuarios"): Cluster taquillas_vestuarios, action new_page_candidate: distinto de /bancos-de-vestuario/ (mobiliario complementario), sin pagina equivalente sobre las taquillas en si; staging 2104 aprobada visualmente.
- Taquillas inteligentes (solucion general) (keyword relacionada: "taquillas inteligentes"): Cluster taquillas_inteligentes_general, action new_page_candidate: es la solucion completa (mueble+cerradura+PIN/RFID/app), distinta del hardware de cierre que ya cubre cerraduras_inteligentes_taquillas; staging 2103 corregida en O28.6 pero aun pendiente de aprobacion visual real, a diferencia de las otras 3 candidatas.

### Enlazado interno recomendado (2)

- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas para mayor resistencia"): Ambas paginas atacan intenciones diferenciadas pero relacionadas (material generico vs. combinacion especifica) segun la decision O29.1 de Pau. Un enlace contextual desde la pagina general ayuda a los usuarios que buscan mas resistencia a la humedad/impactos a encontrar la variante especifica sin fusionar ni canibalizar las paginas.
- https://zentrylockers.com/taquillas-para-colegios/ -> https://zentrylockers.com/cerraduras-inteligentes-taquillas/ ("cerraduras inteligentes para taquillas escolares"): Los centros educativos son un comprador tipico de sistemas de cierre inteligente para taquillas de alumnos; enlazar desde la pagina de sector (colegios, con un quick win pendiente en posicion 25.1 que ya pide mejorar el enlazado interno) hacia la pagina informativa de cerraduras inteligentes refuerza la relevancia tematica cruzada.

### Acciones priorizadas (6)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Corregir el enrutado de actionItems que apuntan a la pagina obsoleta /cerraduras/ (en papelera, redirige a /cerraduras-para-taquillas/) | high | low | high |
| 2 | Cerrar via el script existente las keywords genericas de melamina mal enrutadas a /taquillas-melamina-fenolico/ | high | low | medium |
| 3 | Ejecutar los 6 quick wins on-page ya identificados (posiciones 17-28.8) en cerraduras-inteligentes-taquillas, taquillas-melamina, taquillas-para-colegios y taquillas-para-hospitales | high | medium | medium |
| 4 | Auditar y reescribir meta titles/descriptions en las paginas con 0% CTR pese a impresiones reales (patron sistemico en al menos 6 paginas) | medium | medium | medium |
| 5 | Publicar a produccion las 4 paginas de staging ya aprobadas para los clusters new_page_candidate (universidad, metalicas, vestuarios, taquillas inteligentes general) | medium | medium | high |
| 6 | Documentar en el catalogo de clusters una decision de enrutado para "cerraduras sostenibles para gimnasios" (sin cluster propio y con dos paginas destino distintas) | low | low | low |

### Desconocidos (5)

- No hay cifras exactas de clics mas alla de lo citado en los rationale de cada actionItem (CTR actual 0.00%); no se puede calcular con precision el impacto potencial en clics de cada mejora de CTR.
- No se puede confirmar el estado final de aprobacion de la pagina de staging 2103 (cluster taquillas_inteligentes_general) -- el catalogo la marca como pendiente de aprobacion visual real, a diferencia de las otras 3 candidatas a pagina nueva que si estan confirmadas.
- No hay informacion en este contexto sobre el contenido real actual (texto, H1, meta tags existentes) de las paginas objetivo -- las mejoras on-page se infieren a partir de las acciones sugeridas por el pipeline, no de una auditoria directa del HTML.
- No se puede confirmar si existe canibalizacion adicional no documentada entre otros clusters de sector (colegios, oficinas, empresas, industria, hoteles) mas alla de lo que el catalogo ya resuelve explicitamente.
- Las target keywords "lockers inteligentes", "taquillas para gimnasios" y "digitalizacion de taquillas" no tienen actionItems en este run -- se desconoce su posicion e impresiones actuales en Search Console.

**⚠️ Auditoria: 3 aviso(s) para revision humana:**
- Evidencia "ev15" cita la keyword "comprar taquillas / soluciones de taquillas", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev20" cita la keyword "taquillas colegios / taquillas escolares", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev24" cita la keyword "fabricante de taquillas fenolicas en badajoz", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
