# SEO Specialist — analisis seo-specialist-2026-08-17T23-44-24-312Z-tfic25

- **Generado:** 2026-08-17T23:48:25.055Z
- **runId de datos analizados:** `seo-watcher-2026-08-17T234310Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 0 aviso(s) de auditoria.

### Resumen ejecutivo

Datos live de Search Console (36 jobs, run seo-watcher-2026-08-17T234310Z) cruzados con el catalogo de clusters y de keywords objetivo. El hallazgo mas urgente es tecnico: dos actionItems de alta/media prioridad (\"cerraduras inteligentes para centros deportivos\", \"cerraduras sostenibles para gimnasios\") recomiendan optimizar https://zentrylockers.com/cerraduras/, pagina que el catalogo de clusters documenta como en PAPELERA desde O22 con redireccion 301 a /cerraduras-para-taquillas/ -- ejecutar esas tareas tal cual seria trabajo perdido. En paralelo, persiste en los actionItems la canibalizacion de \"taquillas melamina\"/\"taquillas de melamina\" ya resuelta a nivel de decision (O29.1) pero no limpiada del backlog: siguen apareciendo entradas mal enrutadas a /taquillas-melamina-fenolico/ que deberian concentrarse en /taquillas-melamina/. Del lado positivo, hay 7 quick wins claros (posiciones entre 10.6 y 28.7) sobre paginas ya correctamente enrutadas, y el catalogo de clusters ya ha validado 4 huecos de contenido reales con staging aprobado (universidades, metalicas, vestuarios, taquillas inteligentes general) listos para publicar. Tambien se observa un patron sistemico de CTR 0.00% en multiples paginas con impresiones reales, lo que apunta a un problema generalizado de meta titles/descriptions mas que a casos aislados.

### Findings (7)

- [technical] (evidence) Los actionItems para "cerraduras inteligentes para centros deportivos" (alta prioridad) y "cerraduras sostenibles para gimnasios" apuntan a https://zentrylockers.com/cerraduras/, pagina que el cluster catalog documenta como en PAPELERA desde O22 con redireccion 301 real a /cerraduras-para-taquillas/. Ejecutar la accion sugerida (reforzar meta/contenido de esa URL) seria trabajo desperdiciado sobre una pagina inexistente en produccion.
- [cannibalization] (evidence) La keyword generica "taquillas melamina"/"taquillas de melamina" aparece en los actionItems routeada simultaneamente a /taquillas-melamina/ (correcto) y a /taquillas-melamina-fenolico/ (incorrecto). El cluster catalog documenta explicitamente que esta canibalizacion ya fue resuelta a nivel de decision (O29.1) y que cualquier actionId con esa keyword generica apuntando a la pagina fenolico-especifica debe cerrarse via script, pero el backlog de jobs sigue conteniendo esas entradas mal enrutadas.
- [keyword_strategy] (inference) "cerraduras sostenibles para gimnasios" no tiene ningun cluster que la cubra explicitamente en matchPatterns, y aparece routeada en dos actionItems distintos a dos paginas diferentes (la trashed /cerraduras/ y /cerraduras-inteligentes-taquillas/), senal de que esta keyword no tiene todavia una decision de intencion/cluster tomada.
- [content] (evidence) El cluster catalog ya ha validado 4 huecos de contenido reales (accion new_page_candidate) con paginas de staging ya creadas y en su mayoria visualmente aprobadas: taquillas para universidades, taquillas metalicas, taquillas para vestuarios y la solucion general de taquillas inteligentes.
- [search_intent] (evidence) El cluster de terminos transaccionales genericos ("comprar taquillas", "soluciones de taquillas") esta marcado como postpone: la recomendacion documentada es NO crear paginas nuevas por falta de angulo de producto/sector propio, y mejorar CTA/enlazado interno en paginas ya existentes en su lugar.
- [structure] (inference) Multiples actionItems en paginas distintas (taquillas-melamina, taquillas-para-colegios, cerraduras-inteligentes-taquillas, taquillas-para-hospitales, taquillas-fenolicas, entre otras) reportan CTR 0.00% pese a tener impresiones reales, lo que sugiere un problema sistemico de meta titles/descriptions poco atractivos en todo el sitio y no solo casos aislados por pagina.
- [keyword_strategy] (inference) La keyword objetivo de alta prioridad "taquillas para gimnasios" (catalogo de keywords objetivo) no tiene ningun actionItem ni cluster que la cubra directamente en este contexto -- lo unico relacionado es "cerraduras sostenibles para gimnasios", que es sobre el hardware de cierre, no sobre el mueble taquilla en si.

### Oportunidades (15, prioridad: 2 alta / 11 media / 2 baja)

- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No optimizar /cerraduras/ tal cual (esta en papelera con 301 a /cerraduras-para-taquillas/). Redirigir el esfuerzo de contenido/enlazado a /cerraduras-para-taquillas/ o al cluster de cerraduras inteligentes (targetUrl real /cerraduras-inteligentes-taquillas/), previa decision explicita de Pau sobre cual encaja mejor con la intencion "centros deportivos".
- [medium] (cannibalization, evidence) "cerraduras sostenibles para gimnasios": Definir una unica intencion/cluster para "cerraduras sostenibles para gimnasios" antes de ejecutar cualquier optimizacion: actualmente aparece routeada tanto a /cerraduras/ (papelera) como a /cerraduras-inteligentes-taquillas/, sin decision de cluster documentada que resuelva la ambiguedad.
- [medium] (cannibalization, evidence) "taquillas melamina / taquillas de melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: Cerrar/reenrutar los actionItems de "taquillas melamina" y "taquillas de melamina" que apuntan a /taquillas-melamina-fenolico/ (mal enrutados segun decision O29.1); concentrar todo el esfuerzo de optimizacion de esas keywords genericas en /taquillas-melamina/ via el script ya previsto para esta limpieza.
- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Ajuste on-page menor (H1/H2, meta) para pasar de posicion 10.6 a top 10 -- esta a un paso de primera pagina.
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Reforzar contenido y reescribir meta title/description (CTR actual 0%) para pasar de posicion 17.1 a top 10.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar H1/H2, profundidad de texto, enlazado interno y meta title/description para pasar de posicion 25.1 a top 10.
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Optimizacion on-page para pasar de posicion 24.5 a top 10, incluyendo reescritura de meta (CTR 0%).
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido y meta title/description (CTR 0%) para pasar de posicion 28.7 a top 10.
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizacion on-page y de meta (CTR 0%) para pasar de posicion 27.8 a top 10.
- [medium] (content_gap, evidence) "taquillas universidad": Publicar a produccion la pagina de staging ya aprobada (2110) para el cluster de taquillas para universidades.
- [medium] (content_gap, evidence) "taquillas metalicas": Publicar a produccion la pagina de staging ya aprobada (2105) para taquillas metalicas, tercer material del catalogo sin pagina propia.
- [medium] (content_gap, evidence) "taquillas vestuarios": Publicar a produccion la pagina de staging ya aprobada (2104) para taquillas de vestuarios, diferenciada de bancos de vestuario.
- [low] (content_gap, evidence) "taquillas inteligentes": Completar la revision y aprobacion visual real de la staging 2103 antes de publicar la solucion general de taquillas inteligentes (mueble+cerradura+app/PIN/RFID), evitando fusionarla con el cluster de hardware de cierre.
- [low] (future_opportunity, evidence) "comprar taquillas": No crear paginas nuevas para "comprar taquillas"/"soluciones de taquillas" (decision documentada: postpone); en su lugar, mejorar CTA y enlazado interno hacia paginas de producto/sector ya existentes.

### Problemas tecnicos (1)

- [high] https://zentrylockers.com/cerraduras/: Pagina en papelera (trash) desde O22, con redireccion 301 real a /cerraduras-para-taquillas/, que sigue recibiendo recomendaciones de optimizacion SEO activas desde el backlog de jobs (dos actionItems de prioridad alta/media apuntan a ella).

### Huecos de contenido (7)

- Taquillas para universidades (keyword relacionada: "taquillas universidad"): Sin pagina de produccion equivalente confirmada; cluster action new_page_candidate con staging (2110) ya aprobada visualmente.
- Taquillas metalicas (tercer material del catalogo) (keyword relacionada: "taquillas metalicas"): Gap real detectado por el cluster catalog y reforzado por la keyword objetivo comercial de prioridad media que hoy carece de pagina destino.
- Taquillas para vestuarios (mueble, distinto de bancos de vestuario) (keyword relacionada: "taquillas vestuarios"): Sin pagina equivalente; cluster action new_page_candidate con staging (2104) ya aprobada visualmente.
- Solucion general de taquillas inteligentes (mueble+cerradura+PIN/RFID/app) (keyword relacionada: "taquillas inteligentes"): Distinta del hardware de cierre (cluster cerraduras_inteligentes_taquillas); gap real pero staging (2103) aun pendiente de aprobacion visual real.
- Taquillas para gimnasios (mueble, no cerradura) (keyword relacionada: "taquillas para gimnasios"): Keyword objetivo de alta prioridad sin actionItem ni cluster que la cubra directamente; lo unico relacionado en el contexto es sobre cerraduras, no sobre el mueble.
- Digitalizacion de taquillas (contenido informativo) (keyword relacionada: "digitalizacion de taquillas"): Keyword objetivo informational de prioridad media sin actionItem ni cluster asociado en este contexto -- posible hueco de contenido de fondo de embudo.
- Terminologia "lockers inteligentes" vs "taquillas inteligentes" (keyword relacionada: "lockers inteligentes"): Keyword objetivo comercial de alta prioridad con terminologia distinta (lockers vs taquillas) que no aparece explicitamente en los matchPatterns de ningun cluster -- riesgo de no cubrirla si el contenido nuevo se redacta solo con "taquillas".

### Enlazado interno recomendado (3)

- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> /cerraduras-para-taquillas/ ("catalogo de cerraduras inteligentes ARES, ORBIS, BOXIS y NEO"): El cluster catalog diferencia explicitamente esta pagina (version SEO informativa) de /cerraduras-para-taquillas/ (catalogo comercial). Enlazar desde la pagina informativa a la comercial ayuda a convertir el trafico informativo sin fusionar ambas paginas.
- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas para mayor resistencia"): Ambas paginas estan deliberadamente diferenciadas (material generico vs. combinacion especifica); un enlace claro entre ellas ayuda a los usuarios y motores a distinguir la intencion sin canibalizar, y reduce el riesgo de que Google confunda ambas URLs para la misma query.
- https://zentrylockers.com/taquillas-melamina-fenolico/ -> https://zentrylockers.com/taquillas-melamina/ ("ver toda la gama de taquillas de melamina"): Enlace reciproco al anterior: los usuarios que lleguen buscando la combinacion especifica pueden necesitar ver la gama general de melamina, reforzando la arquitectura de las dos paginas diferenciadas.

### Acciones priorizadas (7)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Corregir el enrutado roto de las tareas sobre /cerraduras/ (pagina en papelera con 301) antes de invertir esfuerzo en ellas | high | low | high |
| 2 | Ejecutar/confirmar la limpieza de la canibalizacion melamina vs melamina-fenolico en el backlog de jobs | high | low | medium |
| 3 | Ejecutar los quick wins on-page ya identificados (posiciones 10-29) en paginas correctamente enrutadas | high | medium | medium |
| 4 | Reescribir meta titles/descriptions en las paginas con CTR 0% detectado de forma recurrente | medium | medium | medium |
| 5 | Publicar a produccion los 3 huecos de contenido ya aprobados en staging (universidades, metalicas, vestuarios) | medium | medium | medium |
| 6 | Enlazar internamente las paginas deliberadamente diferenciadas (melamina/melamina-fenolico, cerraduras informativas/catalogo comercial) | medium | low | medium |
| 7 | Completar aprobacion visual de la staging de taquillas inteligentes general y decidir sobre el cluster postponed de terminos transaccionales genericos | low | low | low |

### Desconocidos (4)

- No hay ningun cluster en el catalogo que cubra explicitamente las paginas /taquillas-para-hospitales/, por lo que no se puede verificar via clusters si su enrutado y diferenciacion de intencion frente a otras paginas de sector es correcto (aunque los actionItems asociados no muestran senales de conflicto).
- No se puede confirmar el estado real en produccion/WordPress (mas alla de lo indicado en action/reason) de las 4 paginas candidatas nuevas (universidad, metalicas, vestuarios, taquillas inteligentes general) -- no hay acceso a ningun CMS para verificarlo directamente.
- No se dispone de la cifra exacta de CTR de cada keyword mas alla del texto "CTR actual 0.00%" incluido en el rationale de cada actionItem -- no se puede diferenciar entre CTR verdaderamente cero y un redondeo del pipeline.
- No se conoce si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ha ejecutado en este run o sigue pendiente -- el contexto no indica su estado de ejecucion.

Auditoria: sin avisos (ninguna afirmacion sin respaldo detectada en el contexto suministrado).

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
