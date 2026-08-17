# SEO Specialist — analisis seo-specialist-2026-08-17T23-06-11-082Z-i8pwbx

- **Generado:** 2026-08-17T23:11:17.314Z
- **runId de datos analizados:** `seo-watcher-2026-08-17T230501Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 1 aviso(s) de auditoria.

### Resumen ejecutivo

Con datos live de Search Console de esta misma pasada (36 jobs, 0h de antiguedad) cruzados contra el catalogo de clusters y de target keywords, el hallazgo mas urgente es que el backlog SEO sigue enviando esfuerzo de optimizacion hacia una URL en papelera (https://zentrylockers.com/cerraduras/, con 301 real a /cerraduras-para-taquillas/) para dos keywords con volumen (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios): cualquier trabajo on-page ahi se perderia. En paralelo, dos actionItems de "taquillas melamina"/"taquillas de melamina" siguen apuntando a /taquillas-melamina-fenolico/ pese a que la decision O29.1 (documentada en el propio catalogo de clusters) ya resolvio esa canibalizacion a favor de /taquillas-melamina/, y existe un script dedicado para cerrarlos que no parece haberse aplicado a estos casos concretos. Hay un patron sistemico de CTR 0.00% en la mayoria de keywords low_ctr repartidas en al menos 8 paginas, lo que apunta a un problema generalizado de meta title/description mas que a casos aislados. Por el lado positivo, tres huecos de contenido (taquillas metalicas, taquillas universidad, taquillas vestuarios) ya tienen su pagina en staging visualmente aprobada y solo pendiente de publicar, mientras que tres target keywords comerciales/informacionales de prioridad alta o media (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) no tienen ningun cluster ni pagina que las cubra en el contexto recibido.

### Findings (7)

- [technical] (evidence) Dos actionItems del backlog (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) apuntan a https://zentrylockers.com/cerraduras/, pero el catalogo de clusters documenta que esa URL esta en papelera desde O22 con redireccion 301 real a /cerraduras-para-taquillas/ -- cualquier optimizacion on-page sobre esa URL se perderia.
- [cannibalization] (evidence) Los actionItems de "taquillas melamina" y "taquillas de melamina" que apuntan a /taquillas-melamina-fenolico/ contradicen la decision O29.1 (Pau) documentada en el cluster taquillas_melamina_fenolico: la keyword generica de melamina debe apuntar a /taquillas-melamina/. Ya existe un script de resolucion (o291-resolve-melamina-cannibalization.ts) que aparentemente no se ha aplicado a estos dos actionItems concretos.
- [keyword_strategy] (evidence) La keyword "cerraduras sostenibles para gimnasios" aparece como dos actionItems separados apuntando a dos paginas distintas (/cerraduras/, obsoleta, y /cerraduras-inteligentes-taquillas/), sin que ningun cluster del catalogo la contemple explicitamente -- routing ambiguo sin decision documentada.
- [content] (evidence) Patron sistemico de CTR 0.00% en la mayoria de actionItems marcados low_ctr, repartido en al menos 8 paginas distintas y multiples keywords -- sugiere un problema generalizado de meta title/description poco atractivos mas que casos aislados.
- [content] (evidence) Tres clusters con action new_page_candidate (taquillas_metalicas, taquillas_universidad, taquillas_vestuarios) ya tienen su pagina en staging creada y visualmente aprobada, listas para pasar a produccion -- son huecos de contenido con el trabajo de desarrollo ya hecho, pendientes solo de publicacion.
- [cannibalization] (evidence) El cluster taquillas_inteligentes_general (solucion general de taquillas inteligentes) tiene staging (2103) corregida pero aun pendiente de aprobacion visual real, y el propio catalogo advierte riesgo de canibalizacion con el cluster cerraduras_inteligentes_taquillas si se publica sin una decision explicita de diferenciacion.
- [keyword_strategy] (evidence) Tres keywords del catalogo de target keywords ("taquillas para gimnasios" prioridad alta, "lockers inteligentes" prioridad alta, "digitalizacion de taquillas" prioridad media) no tienen ningun cluster ni actionItem que las cubra de forma directa en el contexto recibido.

### Oportunidades (23, prioridad: 4 alta / 19 media / 0 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar contenido en H1/H2, ampliar profundidad del texto, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No optimizar la URL actual: definir con Pau si el objetivo correcto es /cerraduras-para-taquillas/ o el cluster de cerraduras inteligentes (1865) antes de invertir en contenido nuevo para esta keyword, ya que /cerraduras/ esta en papelera con 301.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 28.7 a top 10.
- [medium] (cannibalization, evidence) "taquillas melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: Cerrar/redirigir estos actionItems (taquillas melamina y taquillas de melamina apuntando a taquillas-melamina-fenolico) via el script o291-resolve-melamina-cannibalization.ts y reencauzar el esfuerzo hacia /taquillas-melamina/, la pagina correcta segun la decision O29.1.
- [medium] (future_opportunity, evidence) "taquilla madera" — https://zentrylockers.com/taquillas-melamina/: Reforzar la landing con contenido especifico para esta variante (el acabado melamina imita madera), arquitectura de enlazado interno y meta title/description dedicados.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 25.1 a top 10.
- [medium] (future_opportunity, evidence) "taquilla para el personal" — https://zentrylockers.com/taquillas-para-empresas/: Crear/reforzar contenido dedicado a esta intencion (personal=empleados) dentro de la pagina de empresas, con enlazado interno de soporte.
- [medium] (future_opportunity, evidence) "cerraduras electrónicas taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar la landing existente para esta variante (electronica=inteligente en el lenguaje de busqueda de estos usuarios), mejorando meta title/description.
- [medium] (future_opportunity, evidence) "taquillas escolares" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar la landing existente de colegios para la variante "escolares" (misma intencion segun el cluster), con meta title/description dedicados.
- [medium] (future_opportunity, evidence) "taquillas fenólicas en palencia" — https://zentrylockers.com/taquillas-fenolicas/: Reforzar la landing generica de fenolicas (el catalogo trata "Palencia" como ruido geografico sin intencion local propia) con meta title/description mejorados.
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 27.8 a top 10.
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 24.5 a top 10.
- [medium] (future_opportunity, evidence) "fabricante de taquillas fenólicas en badajoz" — https://zentrylockers.com/taquillas-fenolicas/: Reforzar la landing generica de fenolicas para esta consulta long-tail transaccional, con meta title/description mejorados.
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 17.1 a top 10.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Optimizar on-page (H1/H2, profundidad, enlazado interno, meta title/description) para pasar de posicion 10.6 a top 10 -- muy cerca del objetivo.
- [medium] (cannibalization, evidence) "cerraduras sostenibles para gimnasios": Definir con Pau una unica pagina objetivo para esta keyword (candidatos: /cerraduras-inteligentes-taquillas/ o una nueva landing de sostenibilidad) antes de optimizar cualquiera de las dos paginas actuales, ya que ninguna esta documentada en el catalogo de clusters y una de ellas (/cerraduras/) esta obsoleta.
- [medium] (content_gap, evidence) "taquillas metalicas": Publicar a produccion la pagina de staging ya aprobada visualmente (2105) para cubrir este material de catalogo sin pagina propia.
- [medium] (content_gap, evidence) "taquillas universidad": Publicar a produccion la pagina de staging ya aprobada (2110) para el sector universidades, sin equivalente en produccion actualmente.
- [medium] (content_gap, evidence) "taquillas vestuarios": Publicar a produccion la pagina de staging ya aprobada (2104), diferenciada de /bancos-de-vestuario/.
- [medium] (content_gap, evidence) "taquillas inteligentes": Resolver primero el riesgo de canibalizacion documentado frente al cluster cerraduras_inteligentes_taquillas antes de publicar la staging 2103; requiere decision explicita de Pau sobre diferenciacion de intencion (solucion completa vs. hardware de cierre).
- [high] (content_gap, evidence) "taquillas para gimnasios": Evaluar la creacion de una pagina o cluster dedicado a este sector, ya que es una target keyword comercial de prioridad alta sin cobertura documentada en clusters ni en el backlog de acciones actual.
- [high] (content_gap, evidence) "lockers inteligentes": Valorar si esta keyword debe cubrirse mediante el mismo cluster de taquillas inteligentes (staging 2103) como sinonimo terminologico, o si requiere tratamiento propio -- decision pendiente de Pau.
- [medium] (content_gap, evidence) "digitalizacion de taquillas": Valorar contenido informativo (articulo/guia) sobre digitalizacion de taquillas que sirva de contenido de soporte y enlace hacia las paginas comerciales de cerraduras inteligentes y taquillas inteligentes.

### Problemas tecnicos (3)

- [high] https://zentrylockers.com/cerraduras/: Pagina objetivo obsoleta (en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/) sigue siendo el destino de actionItems activos del backlog SEO (cerraduras inteligentes para centros deportivos, cerraduras sostenibles para gimnasios) -- cualquier optimizacion on-page ejecutada aqui se perderia.
- [medium] https://zentrylockers.com/taquillas-melamina-fenolico/: Recibe impresiones de las keywords genericas "taquillas melamina" y "taquillas de melamina", que segun la decision O29.1 documentada deberian apuntar a /taquillas-melamina/ -- mismatch entre el enrutado real y la arquitectura de contenido decidida.
- [medium] multiples paginas del sitio (ver evidenceRefs): CTR 0.00% reportado de forma consistente en la mayoria de keywords marcadas low_ctr, en al menos 8 paginas distintas -- indica un problema generalizado de meta title/meta description poco atractivos en los snippets de resultados, no casos aislados.

### Huecos de contenido (7)

- Taquillas metalicas (nuevo material de catalogo sin pagina propia) (keyword relacionada: "taquillas metalicas"): Tercer material del catalogo (junto a melamina/fenolica) sin pagina de producto propia todavia; staging (2105) ya creada y visualmente aprobada, coincide con target keyword comercial de prioridad media.
- Taquillas para universidades (keyword relacionada: "taquillas universidad"): Sin pagina de produccion equivalente confirmada; staging (2110) ya creada y visualmente aprobada, candidata real a pagina nueva.
- Taquillas para vestuarios (generico, no melamina) (keyword relacionada: "taquillas vestuarios"): Distinto de bancos de vestuario (mobiliario complementario); sin pagina equivalente en produccion. Staging (2104) ya creada y visualmente aprobada.
- Taquillas inteligentes - solucion general (mueble+cerradura+PIN/RFID/app) (keyword relacionada: "taquillas inteligentes"): Distinto del cluster de cerraduras inteligentes (hardware de cierre); staging (2103) corregida pero pendiente de aprobacion visual real y de resolver riesgo de canibalizacion documentado.
- Taquillas para gimnasios (keyword relacionada: "taquillas para gimnasios"): Target keyword comercial de prioridad alta sin cluster ni actionItem que la cubra directamente en el contexto recibido.
- Lockers inteligentes (variante terminologica) (keyword relacionada: "lockers inteligentes"): Target keyword comercial de prioridad alta sin cluster que la mencione literalmente en sus matchPatterns.
- Digitalizacion de taquillas (contenido informativo) (keyword relacionada: "digitalizacion de taquillas"): Target keyword informacional de prioridad media sin cluster ni actionItem asociado; podria funcionar como contenido de soporte hacia paginas comerciales.

### Enlazado interno recomendado (3)

- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas con puertas fenolicas para mayor resistencia"): Ambas paginas conviven en el mismo catalogo de material (melamina) pero atacan intenciones distintas segun la decision O29.1 -- enlazar desde la pagina generica a la variante de combinacion ayuda a diferenciar la intencion para el usuario y a reforzar la senal de que son paginas distintas, no duplicadas.
- https://zentrylockers.com/taquillas-para-empresas/ -> https://zentrylockers.com/taquillas-para-oficinas/ ("taquillas para oficinas"): El catalogo de clusters documenta que ambas paginas comparten cliente final (empresas B2B) aunque se diferencian por entorno fisico -- enlazar entre ellas cubre mejor el recorrido de un mismo buyer persona sin fusionar los clusters.
- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> https://zentrylockers.com/cerraduras-para-taquillas/ ("catalogo de cerraduras inteligentes ARES, ORBIS, BOXIS y NEO"): El cluster catalog diferencia explicitamente la version informativa (esta pagina) del catalogo comercial de producto (/cerraduras-para-taquillas/) -- enlazar desde el contenido informativo hacia el catalogo comercial es el flujo natural de conversion informativo-transaccional.

### Acciones priorizadas (9)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Corregir el enrutado obsoleto de /cerraduras/ antes de cualquier optimizacion | high | low | high |
| 2 | Cerrar la canibalizacion de melamina generica en /taquillas-melamina-fenolico/ via el script ya existente | high | low | medium |
| 3 | Optimizar on-page los quick wins de mayor volumen (H1/H2, profundidad, meta) | high | medium | medium |
| 4 | Reescribir meta titles/descriptions en las paginas con CTR 0% sistemico | medium | medium | medium |
| 5 | Publicar a produccion las paginas de staging ya aprobadas (taquillas metalicas, universidades, vestuarios) | medium | low | medium |
| 6 | Decidir la pagina objetivo unica de "cerraduras sostenibles para gimnasios" | medium | low | low |
| 7 | Resolver el riesgo de canibalizacion antes de publicar la solucion general de taquillas inteligentes | medium | medium | medium |
| 8 | Evaluar cobertura de contenido para target keywords sin cluster (gimnasios, lockers inteligentes, digitalizacion) | medium | high | medium |
| 9 | Implementar enlazado interno estrategico entre paginas relacionadas | low | low | medium |

### Desconocidos (5)

- No hay datos de clics/impresiones desglosados mas alla de las cifras agregadas por keyword+pagina; no se puede confirmar la magnitud exacta de mejora esperada de cada accion.
- No se conoce el estado de aprobacion final de Pau sobre la reasignacion de /cerraduras/ ni sobre la publicacion de taquillas_inteligentes_general (2103).
- No hay informacion en este contexto sobre volumen de busqueda, estacionalidad o intencion detallada para las keywords sin cluster (taquillas para gimnasios, lockers inteligentes, digitalizacion de taquillas) mas alla de su presencia en el catalogo de target keywords.
- No se dispone de datos tecnicos generales del sitio (Core Web Vitals, indexabilidad, sitemap, errores de rastreo) mas alla de lo inferible del backlog de keywords y del catalogo de clusters.
- No se puede verificar el contenido actual completo de cada pagina (H1/H2, longitud de texto real) sin acceso directo al sitio o al repositorio.

**⚠️ Auditoria: 1 aviso(s) para revision humana:**
- Evidencia "ev34" cita la pagina "https://zentrylockers.com/cerraduras-para-taquillas/", que no aparece en los datos locales suministrados en el contexto (actionItems/clusters) -- posible dato inventado.

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
