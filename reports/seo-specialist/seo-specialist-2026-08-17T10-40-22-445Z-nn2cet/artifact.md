# SEO Specialist — analisis seo-specialist-2026-08-17T10-40-22-445Z-nn2cet

- **Generado:** 2026-08-17T10:43:51.496Z
- **runId de datos analizados:** `seo-watcher-2026-08-17T103842Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 0 aviso(s) de auditoria.

### Resumen ejecutivo

Se analizan 20 action items reales de Search Console (run seo-watcher-2026-08-17T103842Z, datos live de esta misma pasada, 0h de antiguedad) junto con el catalogo de 10 keywords objetivo y 20 clusters SEO. El hallazgo mas urgente es tecnico-estrategico: dos action items siguen apuntando a https://zentrylockers.com/cerraduras/, una URL que el propio catalogo de clusters marca como en papelera con redireccion 301 desde O22 -- cualquier trabajo on-page ahi se perderia. Ademas se detecta una posible canibalizacion no documentada ("cerraduras sostenibles para gimnasios" repartida entre dos paginas distintas) y una canibalizacion que el catalogo da por resuelta en O29.1 pero que sigue apareciendo en el backlog vivo ("taquillas melamina"/"taquillas de melamina" enrutando trafico hacia /taquillas-melamina-fenolico/ en vez de /taquillas-melamina/). En el lado positivo, hay un quick win claro y de alta prioridad ("cerraduras inteligentes para taquillas", posicion 20.5, 47 impresiones) y varios quick wins de bajo esfuerzo con CTR 0% pese a impresiones reales. El catalogo de clusters ya tiene identificados 4 huecos de contenido aprobados en staging (universidades, taquillas metalicas, vestuarios, taquillas inteligentes general) pendientes de pasar a produccion, y 3 keywords objetivo del negocio (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) sin cluster ni pagina asociada visible en este contexto.

### Findings (8)

- [technical] (evidence) Dos action items en vivo ("cerraduras inteligentes para centros deportivos" y "cerraduras sostenibles para gimnasios") recomiendan crear/reforzar contenido en https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real hacia /cerraduras-para-taquillas/. Ejecutar esas acciones tal cual desperdiciaria esfuerzo sobre una pagina que no sirve trafico real.
- [cannibalization] (inference) La keyword "cerraduras sostenibles para gimnasios" genera dos action items distintos apuntando a dos paginas diferentes (/cerraduras/ y /cerraduras-inteligentes-taquillas/), sin que ningun cluster del catalogo documente ni resuelva esta interseccion -- posible canibalizacion no gestionada.
- [cannibalization] (evidence) El cluster taquillas_melamina_fenolico documenta explicitamente (decision O29.1) que la keyword generica "melamina" NO debe apuntar a /taquillas-melamina-fenolico/ y que cualquier actionId con esa keyword generica en esa URL esta mal enrutado. Sin embargo, en el backlog vivo de esta pasada siguen apareciendo action items para "taquillas melamina" y "taquillas de melamina" apuntando precisamente a /taquillas-melamina-fenolico/ en vez de a /taquillas-melamina/ (su cluster correcto segun matchPatterns/excludePatterns).
- [keyword_strategy] (evidence) Tres keywords objetivo del catalogo de negocio ("taquillas para gimnasios" -- alta prioridad, "lockers inteligentes" -- alta prioridad, "digitalizacion de taquillas" -- media prioridad) no tienen ningun cluster ni action item asociado visible en este contexto, quedando sin pagina de destino clara.
- [content] (evidence) El catalogo de clusters ya tiene 4 candidatos a pagina nueva (universidades, taquillas metalicas, taquillas para vestuarios, taquillas inteligentes general) con staging ya creado y en su mayoria visualmente aprobado, pendientes de avanzar a produccion.
- [keyword_strategy] (evidence) El cluster de terminos comerciales genericos ("comprar taquillas", "soluciones de taquillas") esta marcado como postpone: intencion transaccional real pero sin angulo de producto/sector propio, con alto riesgo de canibalizar paginas de sector/material ya existentes si se crean paginas nuevas para ello.
- [structure] (inference) Multiples paginas con impresiones reales (colegios, melamina, melamina-fenolico, fenolicas) muestran CTR 0.00% en los action items de esta pasada, un patron repetido que sugiere un problema sistemico de meta titles/descriptions poco atractivos en varias familias de paginas, no un caso aislado.
- [content] (evidence) Las keywords del sector hospitales ("taquillas para hospital", "comprar taquillas para hospitales") tienen action items reales y una pagina de destino consolidada (/taquillas-para-hospitales/), pero no existe ninguna entrada de cluster para este sector en el catalogo -- una posible laguna de gobernanza del catalogo de clusters.

### Oportunidades (8, prioridad: 2 alta / 6 media / 0 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion 20.5 a top 10.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Ajuste ligero de on-page (title/meta/H1) para consolidar la posicion 10.6 dentro de top 10, dado que ya esta al borde de la primera pagina.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Reescribir meta title/description (CTR actual 0.00%) y reforzar contenido on-page para pasar de posicion 25.1 a top 10.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido on-page y reescribir meta title/description alineados con el recommendedTitle/recommendedMetaDescription ya definidos para este cluster (pagina correcta segun O29.1).
- [medium] (cannibalization, inference) "cerraduras sostenibles para gimnasios": Decidir con Pau una unica pagina de destino para esta keyword (candidatas: /cerraduras-inteligentes-taquillas/ o una landing de sector deportivo) antes de invertir en contenido, en vez de dejar que ambas paginas compitan.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No ejecutar la accion tal cual: redirigir el esfuerzo hacia /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (/cerraduras-inteligentes-taquillas/), a decidir por Pau, ya que la URL actual esta en papelera con 301.
- [medium] (content_gap, evidence) "taquillas universidad / taquillas metalicas / taquillas vestuarios / taquillas inteligentes": Avanzar a produccion los 4 clusters new_page_candidate ya creados y en su mayoria aprobados visualmente en staging (universidades, metalicas, vestuarios, inteligentes general), priorizando taquillas_metalicas por coincidir con una keyword objetivo del negocio.
- [medium] (technical, evidence) "taquillas melamina / taquillas de melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: Cerrar/realinear estos action items del backlog para que la keyword generica "melamina" apunte a /taquillas-melamina/ en lugar de /taquillas-melamina-fenolico/, conforme a la decision O29.1 ya aprobada.

### Problemas tecnicos (3)

- [high] https://zentrylockers.com/cerraduras/: Pagina en papelera desde O22 con redireccion 301 real hacia /cerraduras-para-taquillas/, pero sigue recibiendo recomendaciones de trabajo on-page/contenido nuevo desde el backlog vivo de esta pasada.
- [medium] https://zentrylockers.com/taquillas-melamina-fenolico/: Recibe action items para la keyword generica "melamina", contraviniendo la decision O29.1 que reserva esta URL exclusivamente para la combinacion especifica melamina+fenolico.
- [medium] https://zentrylockers.com/taquillas-para-colegios/: CTR 0.00% pese a impresiones reales, patron que se repite en varias paginas de material/sector (melamina, fenolicas, melamina-fenolico) -- sugiere meta titles/descriptions poco atractivos de forma sistemica.

### Huecos de contenido (7)

- Taquillas para universidades (keyword relacionada: "taquillas universidad"): Cluster new_page_candidate sin pagina de produccion equivalente confirmada; staging ya creado y visualmente aprobado.
- Taquillas metalicas (keyword relacionada: "taquillas metalicas"): Tercer material del catalogo (junto a melamina/fenolica) sin pagina propia; ademas coincide con una keyword objetivo de prioridad media del negocio.
- Taquillas para vestuarios (keyword relacionada: "taquillas para vestuarios"): Distinto de /bancos-de-vestuario/ (mobiliario complementario); sin pagina equivalente, staging ya aprobado.
- Taquillas inteligentes (solucion general, mueble+cerradura+PIN/RFID/app) (keyword relacionada: "taquillas inteligentes"): Distinto del hardware de cierre (cluster cerraduras_inteligentes_taquillas); staging corregido en O28.6, pendiente de aprobacion visual real.
- Taquillas para gimnasios (keyword relacionada: "taquillas para gimnasios"): Keyword objetivo de alta prioridad (commercial) sin cluster ni pagina asociada visible en este contexto.
- Lockers inteligentes (keyword relacionada: "lockers inteligentes"): Keyword objetivo de alta prioridad sin cluster explicito; podria solapar con taquillas_inteligentes_general pero requiere decision humana antes de fusionar.
- Digitalizacion de taquillas (keyword relacionada: "digitalizacion de taquillas"): Keyword objetivo informacional de prioridad media sin cluster ni pagina asociada visible en este contexto.

### Enlazado interno recomendado (3)

- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas"): Ambas paginas atacan intenciones deliberadamente diferenciadas (material generico vs. combinacion especifica); un enlace cruzado ayuda al usuario a autoseleccionar el producto correcto y refuerza la diferenciacion que ya decidio Pau en O29.1, reduciendo el riesgo de que Google las siga confundiendo.
- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> https://zentrylockers.com/cerraduras-para-taquillas/ ("ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO"): El cluster de cerraduras inteligentes es la version informativa; enlazar hacia la pagina comercial de catalogo (mencionada explicitamente en el catalogo de clusters) ayuda a completar el funnel informativo->comercial sin fusionar ambas paginas.
- https://zentrylockers.com/taquillas-melamina-fenolico/ -> https://zentrylockers.com/taquillas-melamina/ ("ver gama completa de taquillas de melamina"): Enlace reciproco al anterior (i1); ayuda a que el trafico que llega a la pagina especifica por error de busqueda generica encuentre facilmente la pagina general correcta.

### Acciones priorizadas (7)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Resolver la situacion de /cerraduras/ (pagina en papelera con redireccion) y decidir destino unico para "cerraduras inteligentes centros deportivos"/"cerraduras sostenibles para gimnasios" | high | low | high |
| 2 | Ejecutar quick win on-page para "cerraduras inteligentes para taquillas" | high | medium | medium |
| 3 | Realinear backlog: mover action items de "melamina" generica de /taquillas-melamina-fenolico/ a /taquillas-melamina/ segun decision O29.1 | medium | low | medium |
| 4 | Reescribir meta titles/descriptions en paginas con CTR 0% pese a impresiones reales (colegios, melamina, fenolicas) | medium | low | medium |
| 5 | Publicar a produccion los 4 content gaps ya aprobados en staging (universidades, metalicas, vestuarios, inteligentes general) | medium | medium | medium |
| 6 | Ajuste menor de quick wins ya cercanos a top 10 en el sector hospitales | medium | low | low |
| 7 | Decidir estrategia para keywords objetivo sin cluster asignado (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) | low | medium | medium |

### Desconocidos (5)

- No se dispone de cifras de clics/conversion post-clic mas alla del CTR 0.00% reportado en los action items.
- No se sabe si el script de resolucion de canibalizacion de melamina (O29.1, scripts/o291-resolve-melamina-cannibalization.ts) ya se ejecuto sobre estos jobs concretos o si son entradas nuevas aun no barridas.
- No existe entrada de cluster para el sector hospitales pese a tener pagina real y action items activos -- se desconoce si es una omision del catalogo o una decision consciente no documentada en este contexto.
- Solo se dispone de las rutas del ultimo informe del SEO Watcher/Director, no de su contenido, por lo que no se puede contrastar si estos hallazgos ya fueron reportados o accionados previamente.
- No hay confirmacion explicita de si la keyword objetivo 'lockers inteligentes' debe fusionarse con el cluster taquillas_inteligentes_general o tratarse como cluster aparte.

Auditoria: sin avisos (ninguna afirmacion sin respaldo detectada en el contexto suministrado).

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
