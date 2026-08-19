# SEO Specialist — analisis seo-specialist-2026-08-19T07-32-24-450Z-u91u30

- **Generado:** 2026-08-19T07:37:02.088Z
- **runId de datos analizados:** `seo-watcher-2026-08-19T073048Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 6 aviso(s) de auditoria.

### Resumen ejecutivo

Analisis sobre datos LIVE de Search Console leidos en esta misma pasada (19 action items agregados, 36 jobs, catalogo de 10 keywords objetivo y 20 clusters). El backlog esta mayoritariamente sano y ya alineado con decisiones previas de Pau, pero hay dos problemas concretos que conviene resolver antes de invertir esfuerzo en optimizacion: (1) dos keywords de "cerraduras inteligentes para centros deportivos / gimnasios" siguen apuntando a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters marca en papelera con redireccion 301 a /cerraduras-para-taquillas/; (2) dos action items de "taquillas melamina"/"taquillas de melamina" siguen apuntando a /taquillas-melamina-fenolico/, contradiciendo la resolucion de canibalizacion ya aprobada (O29.1) que reserva esa URL para la combinacion especifica melamina+fenolico. Ademas hay un patron sistemico de CTR 0% en casi todas las paginas con impresiones, dos keywords objetivo de alta prioridad ("taquillas para gimnasios" y "lockers inteligentes") sin ninguna cobertura detectable en action items ni clusters, y varios content gaps ya validados en staging (metalicas, vestuarios, universidades) listos para pasar a produccion. Un quick win claro y de alta prioridad es "cerraduras inteligentes para taquillas" (posicion 20.4, a un empujon de top 10).

### Findings (8)

- [technical] (evidence) Los action items de 'cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios' apuntan a https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ y marca la tarea como 'no ejecutar tal cual'. Optimizar contenido sobre una URL muerta desperdiciaria esfuerzo.
- [cannibalization] (evidence) Dos action items ('taquillas melamina' y 'taquillas de melamina') apuntan a https://zentrylockers.com/taquillas-melamina-fenolico/, pero el cluster taquillas_melamina_fenolico documenta explicitamente que la decision O29.1 (aprobada) reserva esa keyword generica para /taquillas-melamina/ y marca cualquier action item generico apuntando a la pagina de combinacion como mal enrutado, pendiente de cierre via script.
- [search_intent] (evidence) El catalogo de keywords objetivo clasifica 'cerraduras inteligentes para taquillas' como comercial de prioridad alta, pero el cluster que la sirve (cerraduras_inteligentes_taquillas) tiene searchIntent 'informativo' y su propia justificacion senala que la version comercial vive en una URL distinta (/cerraduras-para-taquillas/, catalogo ARES/ORBIS/BOXIS/NEO). Si la pagina se redacta de forma puramente informativa, puede limitar la conversion aunque mejore el ranking.
- [keyword_strategy] (inference) Dos keywords objetivo de prioridad alta y tipo comercial ('taquillas para gimnasios' y 'lockers inteligentes') no aparecen en ningun action item ni en ningun cluster del contexto recibido: no hay ninguna pagina, tarea ni decision registrada que las este atacando.
- [content] (inference) La keyword objetivo informacional de prioridad media 'digitalizacion de taquillas' tampoco aparece en action items ni en clusters, sugiriendo un vacio de contenido de tipo top-of-funnel no cubierto todavia.
- [technical] (evidence) Un numero elevado de action items comparte CTR 0.00% pese a tener impresiones reales (taquillas melamina, taquillas de melamina, taquillas melamina-fenolico, taquillas colegios, taquillas fenolicas en palencia, entre otros), lo que apunta a un problema sistemico de titles/meta descriptions poco atractivos en varias paginas, no a casos aislados.
- [other] (evidence) El catalogo de clusters documenta keywords truncadas/genericas ('cerradura para', 'sistemas de cierre') con 0 impresiones entrando al backlog sin intencion clara, y recomienda revisar la limpieza de queries en el origen (SEO Watcher) para evitar que vuelvan a aparecer.
- [cannibalization] (evidence) El cluster taquillas_inteligentes_general (solucion general mueble+cerradura+PIN/RFID/app, pendiente de aprobacion visual real) documenta un riesgo de canibalizacion propio con el cluster cerraduras_inteligentes_taquillas (hardware de cierre) y exige decision explicita de Pau antes de fusionar o publicar sin diferenciar bien ambas paginas.

### Oportunidades (16, prioridad: 2 alta / 12 media / 2 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2 y profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.4 a top 10.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos / cerraduras sostenibles para gimnasios" — https://zentrylockers.com/cerraduras/: No invertir en optimizar esta URL: esta en papelera con redireccion 301 a /cerraduras-para-taquillas/. Corregir el enrutado del backlog hacia /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (informativo), a decidir por Pau, antes de crear contenido nuevo.
- [medium] (cannibalization, evidence) "taquillas melamina / taquillas de melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: Cerrar/reenrutar estos action items hacia https://zentrylockers.com/taquillas-melamina/ per decision O29.1 ya aprobada; confirmar ejecucion de scripts/o291-resolve-melamina-cannibalization.ts.
- [medium] (quick_win, evidence) "taquillas melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido y reescribir meta title/description para pasar de posicion 30.0 a top 10 y corregir CTR 0%.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Mismo trabajo on-page que 'taquillas melamina' en la misma pagina (variante de la misma intencion).
- [medium] (future_opportunity, evidence) "taquilla madera" — https://zentrylockers.com/taquillas-melamina/: No crear contenido separado: incluir explicitamente esta variante (acabado que imita madera) dentro del mismo refuerzo de contenido de /taquillas-melamina/.
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Incorporar mencion especifica a vestuarios dentro del refuerzo de contenido de /taquillas-melamina/ y mejorar meta description con ese matiz.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar contenido H1/H2 y reescribir meta title/description para pasar de posicion 25.1 a top 10 y corregir CTR 0%.
- [medium] (future_opportunity, evidence) "taquillas escolares" — https://zentrylockers.com/taquillas-para-colegios/: Tratar como sinonimo de 'taquillas colegios' dentro del mismo trabajo de refuerzo de contenido, sin crear pagina separada.
- [medium] (future_opportunity, evidence) "taquilla para el personal" — https://zentrylockers.com/taquillas-para-empresas/: Reforzar la pagina existente incorporando el angulo 'para el personal/empleados' en vez de crear contenido nuevo separado, y mejorar meta title/description (CTR 0%).
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar contenido y meta title/description para pasar de posicion 24.6 a top 10.
- [medium] (future_opportunity, evidence) "cerraduras electrónicas taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Incluir esta variante dentro del mismo trabajo de refuerzo de la pagina, sin duplicar esfuerzo.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Reforzar contenido para pasar de posicion 10.6 a top 10 (esta ya practicamente en el limite de primera pagina).
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Incluir esta variante en el mismo trabajo de refuerzo de /taquillas-para-hospitales/ y corregir CTR 0% en meta description.
- [low] (future_opportunity, evidence) "taquillas fenólicas en palencia" — https://zentrylockers.com/taquillas-fenolicas/: No crear landing geografica dedicada; tratar como variante generica dentro del refuerzo de /taquillas-fenolicas/, siguiendo la decision ya tomada de tratar 'en Palencia' como ruido geografico.
- [low] (future_opportunity, inference) "fabricante de taquillas fenólicas en badajoz" — https://zentrylockers.com/taquillas-fenolicas/: Tratar con el mismo criterio que 'en Palencia': no crear landing geografica dedicada, mantener dentro del refuerzo generico de /taquillas-fenolicas/; dado el esfuerzo alto y el impacto bajo, deprioritizar frente a otras oportunidades.

### Problemas tecnicos (2)

- [high] https://zentrylockers.com/cerraduras/: Dos keywords del backlog SEO ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios') apuntan a esta URL, que segun el catalogo de clusters esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/. Cualquier trabajo on-page aqui se perderia.
- [medium] https://zentrylockers.com/taquillas-melamina/: Patron recurrente de CTR 0.00% en varias paginas con impresiones reales (taquillas melamina/de melamina, taquillas colegios, taquillas fenolicas en Palencia, entre otras), lo que sugiere que los meta titles/descriptions actuales no son lo suficientemente atractivos en varias paginas a la vez, no solo en una.

### Huecos de contenido (7)

- Taquillas metalicas (pagina de producto propia) (keyword relacionada: "taquillas metalicas"): Tercer material del catalogo (junto a melamina y fenolica) sin pagina de producto propia todavia; ya existe borrador en staging visualmente aprobado listo para pasar a produccion.
- Taquillas para vestuarios (pagina propia, distinta de bancos de vestuario) (keyword relacionada: "taquillas para vestuarios"): El cluster taquillas_vestuarios detecta un hueco real (distinto de /bancos-de-vestuario/) sin pagina equivalente; staging ya creada y visualmente aprobada.
- Taquillas para universidades (keyword relacionada: "taquillas universidad"): Sin pagina de produccion equivalente confirmada; staging ya creada y visualmente aprobada, candidata real a pagina nueva.
- Taquillas inteligentes (solucion general mueble+cerradura+PIN/RFID/app) (keyword relacionada: "taquillas inteligentes"): Distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); hueco real detectado pero con riesgo de canibalizacion documentado y pendiente de aprobacion visual real antes de publicar.
- Taquillas para gimnasios (keyword relacionada: "taquillas para gimnasios"): Keyword objetivo comercial de prioridad alta sin ningun action item ni cluster que la ataque en el contexto recibido; posible hueco estrategico no detectado todavia por el pipeline de clustering.
- Lockers inteligentes (keyword relacionada: "lockers inteligentes"): Keyword objetivo comercial de prioridad alta sin action item ni cluster asociado; no coincide con los matchPatterns de ningun cluster existente (ni taquillas_inteligentes_general ni cerraduras_inteligentes_taquillas la cubren literalmente), por lo que su cobertura real es incierta.
- Digitalizacion de taquillas (contenido informacional top-of-funnel) (keyword relacionada: "digitalizacion de taquillas"): Keyword objetivo informacional sin action item ni cluster asociado; posible pieza de contenido informativo de soporte para el cluster de cerraduras/taquillas inteligentes.

### Enlazado interno recomendado (3)

- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas"): Ambas paginas estan deliberadamente diferenciadas (material generico vs. combinacion especifica) segun decision O29.1; enlazarlas entre si ayuda a usuarios y motores a distinguir la intencion y reduce el riesgo de que vuelva a producirse el enrutado erroneo detectado en f2/o3.
- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> /cerraduras-para-taquillas/ ("ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO"): La pagina informativa de cerraduras inteligentes puede canalizar la intencion comercial hacia el catalogo de producto que el propio cluster identifica como su version transaccional diferenciada, mejorando la conversion sin diluir el enfoque informativo de la pagina origen.
- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-fenolicas/ ("comparar con taquillas fenolicas"): Ambas son paginas de material de producto dentro del mismo catalogo comercial; un enlace cruzado de comparacion de materiales puede reducir el rebote de usuarios indecisos entre acabados sin crear contenido nuevo.

### Acciones priorizadas (9)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Corregir el enrutado de 'cerraduras inteligentes para centros deportivos / gimnasios' antes de invertir en contenido (URL en papelera con 301) | high | low | high |
| 2 | Cerrar/reenrutar los action items mal enrutados de 'taquillas melamina/de melamina' hacia /taquillas-melamina/ segun la decision O29.1 ya aprobada | high | low | medium |
| 3 | Optimizacion on-page de 'cerraduras inteligentes para taquillas' (quick win de alta prioridad, a un empujon de top 10) | high | medium | medium |
| 4 | Refuerzo consolidado de contenido y metas para /taquillas-melamina/ (melamina, de melamina, taquilla madera, vestuarios de melamina) | medium | medium | medium |
| 5 | Refuerzo consolidado de contenido y metas para /taquillas-para-colegios/, /cerraduras-inteligentes-taquillas/ y /taquillas-para-hospitales/ | medium | medium | medium |
| 6 | Publicar a produccion los content gaps ya validados en staging (taquillas metalicas, taquillas para vestuarios, taquillas para universidades) | medium | low | medium |
| 7 | Revision estrategica de las keywords objetivo de alta prioridad sin cobertura ('taquillas para gimnasios', 'lockers inteligentes') | high | high | high |
| 8 | Auditoria de meta titles/descriptions para corregir el patron sistemico de CTR 0% | medium | medium | medium |
| 9 | Implementar enlazado interno cruzado entre paginas de materiales/intencion relacionadas | low | low | low |

### Desconocidos (5)

- No se dispone de datos de clics reales (solo impresiones y posicion media), por lo que el impacto de trafico potencial de cada oportunidad es una estimacion indirecta, no una cifra medida de conversion.
- No hay confirmacion en este contexto de si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ha ejecutado sobre estos action items concretos o si siguen pendientes de cierre.
- No se recibio informacion de crawl tecnico (velocidad de pagina, Core Web Vitals, indexabilidad real, sitemap) mas alla de lo que documentan los clusters sobre paginas en papelera/redirecciones -- cualquier problema tecnico adicional no puede evaluarse.
- No hay datos sobre si los staging drafts ya visualmente aprobados (2104, 2105, 2110, 2103) tienen fecha prevista de publicacion o bloqueos pendientes fuera de la aprobacion visual.
- No se recibio el contenido de los informes previos del SEO Watcher/SEO Director (solo sus rutas), por lo que no se puede contrastar este analisis con hallazgos anteriores.

**⚠️ Auditoria: 6 aviso(s) para revision humana:**
- Evidencia "ev-10" cita la keyword "taquillas melamina / taquillas de melamina", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev-11" cita la keyword "taquillas melamina / taquilla madera", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev-16" cita la keyword "taquillas colegios / taquillas escolares", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev-21" cita la keyword "cerraduras inteligentes/electronicas para taquillas", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev-35" cita la keyword "comprar taquillas / soluciones de taquillas", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.
- Evidencia "ev-36" cita la keyword "cerradura para / sistemas de cierre", que no aparece en los datos locales suministrados en el contexto (actionItems/targetKeywords/clusters) -- posible dato inventado.

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
