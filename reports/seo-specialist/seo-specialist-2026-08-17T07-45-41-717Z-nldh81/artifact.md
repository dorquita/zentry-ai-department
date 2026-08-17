# SEO Specialist — analisis seo-specialist-2026-08-17T07-45-41-717Z-nldh81

- **Generado:** 2026-08-17T07:50:05.768Z
- **runId de datos analizados:** `seo-watcher-2026-08-17T074406Z`
- **actionItems en contexto:** 19
- **targetKeywords en contexto:** 10
- **clusters en contexto:** 20

**Ninguna recomendacion se ha aplicado. No hay ejecucion automatica de ninguna accion SEO.**

## Resultado

- **Estado: ejecutado.** 0 aviso(s) de auditoria.

### Resumen ejecutivo

Datos live de Search Console de esta misma pasada (36 jobs, run seo-watcher-2026-08-17T074406Z). El backlog de action items es mayoritariamente solido, pero aparecen dos problemas de enrutado que conviene resolver antes de ejecutar nada: (1) dos keywords ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios') tienen tareas activas apuntando a https://zentrylockers.com/cerraduras/, pagina que el catalogo de clusters marca como en papelera con redireccion 301 real a /cerraduras-para-taquillas/; y (2) sigue habiendo action items de keywords genericas de melamina ('taquillas melamina', 'taquillas de melamina') apuntando a /taquillas-melamina-fenolico/ pese a que la decision O29.1 ya documenta esa combinacion como mal enrutada y con proceso de cierre definido. Ademas hay un patron sistemico de CTR 0% en la mayoria de oportunidades low_ctr, tres paginas nuevas ya aprobadas en staging (metalicas, vestuarios, universidades) listas para publicar, y dos keywords objetivo de alta prioridad ('taquillas para gimnasios', 'lockers inteligentes') sin ningun actionItem ni cluster que las cubra explicitamente. Se priorizan primero las correcciones de enrutado (bajo esfuerzo, alto impacto), luego los quick wins de posicion cercana a top10, y despues las mejoras de CTR y publicacion de contenido nuevo ya validado.

### Findings (6)

- [technical] (evidence) La pagina https://zentrylockers.com/cerraduras/ esta marcada en el catalogo de clusters como obsoleta (en papelera desde O22, con redireccion 301 real a /cerraduras-para-taquillas/), pero el backlog de action items sigue generando/dirigiendo tareas activas hacia ella para dos keywords distintas ('cerraduras inteligentes para centros deportivos' y 'cerraduras sostenibles para gimnasios'). Ejecutar trabajo on-page o de contenido sobre una URL en papelera desperdicia esfuerzo.
- [cannibalization] (evidence) La decision O29.1 (ya aprobada) resuelve la canibalizacion entre /taquillas-melamina/ (generico) y /taquillas-melamina-fenolico/ (combinacion especifica), indicando que cualquier actionId con la keyword generica 'melamina' apuntando a la pagina fenolico esta mal enrutado y debe cerrarse via script (scripts/o291-resolve-melamina-cannibalization.ts). Sin embargo, en este run siguen apareciendo action items activos ('taquillas melamina' y 'taquillas de melamina', ~113 impresiones combinadas) apuntando a /taquillas-melamina-fenolico/, lo que sugiere que el cierre automatico no se ha aplicado a estos items o que han vuelto a generarse.
- [cannibalization] (inference) 'cerraduras sostenibles para gimnasios' no coincide con ningun matchPattern de los clusters catalogados y el pipeline la ha repartido entre dos paginas distintas (/cerraduras/, obsoleta, y /cerraduras-inteligentes-taquillas/, viva). Sin una decision de cluster explicita, existe riesgo de duplicar esfuerzo o de canibalizacion entre ambas paginas para la misma consulta.
- [structure] (evidence) La gran mayoria de las oportunidades marcadas como low_ctr en este run comparten CTR actual de 0.00% pese a tener impresiones reales (entre 20 y 86 por keyword), lo que apunta a un problema sistemico de snippets (title/meta description) poco atractivos en varias paginas de producto/sector, no a un caso aislado.
- [keyword_strategy] (evidence) Las keywords objetivo de alta prioridad 'taquillas para gimnasios' y 'lockers inteligentes' (catalogo estatico, tipo commercial) no tienen ningun actionItem activo en este run ni un cluster catalogado con targetUrl definida que las cubra explicitamente -- hueco entre la estrategia de negocio declarada y la ejecucion SEO actual.
- [content] (evidence) Cuatro clusters con action new_page_candidate (taquillas_metalicas, taquillas_vestuarios, taquillas_universidad, taquillas_inteligentes_general) ya tienen paginas de staging creadas; tres estan visualmente aprobadas y listas para pasar a produccion, mientras que taquillas_inteligentes_general sigue pendiente de aprobacion visual real.

### Oportunidades (19, prioridad: 2 alta / 17 media / 0 baja)

- [high] (quick_win, evidence) "cerraduras inteligentes para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, ampliar profundidad de contenido, mejorar enlazado interno y actualizar meta title/description para pasar de posicion ~20.5 a top 10. Target confirmado como correcto por el cluster cerraduras_inteligentes_taquillas.
- [high] (technical, evidence) "cerraduras inteligentes para centros deportivos" — https://zentrylockers.com/cerraduras/: No ejecutar el on-page tal cual: /cerraduras/ esta en papelera con redireccion 301 real a /cerraduras-para-taquillas/. Antes de cualquier trabajo de contenido, decidir con Pau el target correcto (posiblemente /cerraduras-para-taquillas/ o el cluster cerraduras_inteligentes_taquillas) y corregir el backlog.
- [medium] (future_opportunity, evidence) "taquillas melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar contenido y snippet de /taquillas-melamina/ para 'taquillas melamina' (86 impresiones, CTR 0%); target correcto confirmado por el cluster taquillas_melamina.
- [medium] (quick_win, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar H1/H2, contenido y meta title/description en /taquillas-melamina/ para pasar de posicion 28.7 a top 10.
- [medium] (cannibalization, evidence) "taquillas melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: No ejecutar como landing nueva: segun la decision O29.1 esta keyword generica esta mal enrutada a esta URL de combinacion especifica. Cerrar/reasignar este actionId a /taquillas-melamina/ via el proceso ya definido.
- [medium] (cannibalization, evidence) "taquillas de melamina" — https://zentrylockers.com/taquillas-melamina-fenolico/: No ejecutar como landing nueva: mismo caso de mal enrutado que 'taquillas melamina'; cerrar/reasignar a /taquillas-melamina/.
- [medium] (future_opportunity, evidence) "taquilla madera" — https://zentrylockers.com/taquillas-melamina/: Crear o ampliar seccion de contenido de soporte en /taquillas-melamina/ para 'taquilla madera' (acabado melamina que imita madera), alineado con la decision del cluster taquillas_melamina.
- [medium] (quick_win, evidence) "taquillas colegios" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar H1/H2, contenido y meta title/description en /taquillas-para-colegios/ para pasar de posicion 25.1 a top 10.
- [medium] (future_opportunity, evidence) "taquillas escolares" — https://zentrylockers.com/taquillas-para-colegios/: Reforzar contenido de soporte para 'taquillas escolares' dentro de /taquillas-para-colegios/, cubierta por el mismo cluster que 'taquillas colegios'.
- [medium] (future_opportunity, evidence) "taquilla para el personal" — https://zentrylockers.com/taquillas-para-empresas/: Reforzar contenido y snippet de /taquillas-para-empresas/ para 'taquilla para el personal', intencion comercial equivalente segun el cluster taquillas_empresas_personal.
- [medium] (future_opportunity, evidence) "cerraduras electrónicas taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar contenido de /cerraduras-inteligentes-taquillas/ para esta variante, ya cubierta por el cluster cerraduras_inteligentes_taquillas.
- [medium] (quick_win, evidence) "cerraduras electronicas para taquillas" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Reforzar H1/H2, contenido y meta title/description para pasar de posicion 24.5 a top 10.
- [medium] (future_opportunity, evidence) "taquillas fenólicas en palencia" — https://zentrylockers.com/taquillas-fenolicas/: Tratar como cluster generico de fenolicas (sin angulo geografico especifico, segun el catalogo) reforzando el contenido de /taquillas-fenolicas/, no crear una pagina geografica aparte.
- [medium] (future_opportunity, evidence) "fabricante de taquillas fenólicas en badajoz" — https://zentrylockers.com/taquillas-fenolicas/: Mismo tratamiento que la variante Palencia: reforzar /taquillas-fenolicas/ sin crear pagina geografica dedicada.
- [medium] (quick_win, evidence) "taquillas vestuarios de melamina" — https://zentrylockers.com/taquillas-melamina/: Reforzar H1/H2, contenido y meta title/description en /taquillas-melamina/ para pasar de posicion 27.8 a top 10.
- [medium] (quick_win, evidence) "taquillas para hospital" — https://zentrylockers.com/taquillas-para-hospitales/: Reforzar H1/H2, contenido y meta title/description para pasar de posicion 17.1 a top 10.
- [medium] (quick_win, evidence) "comprar taquillas para hospitales" — https://zentrylockers.com/taquillas-para-hospitales/: Reforzar H1/H2 y contenido comercial en /taquillas-para-hospitales/ para pasar de posicion 10.6 a top 10.
- [medium] (cannibalization, evidence) "cerraduras sostenibles para gimnasios" — https://zentrylockers.com/cerraduras/: No ejecutar directamente: pagina destino en papelera. Ademas la misma keyword tambien aparece apuntando a /cerraduras-inteligentes-taquillas/ en este mismo run. Decidir un cluster/target unico antes de actuar.
- [medium] (future_opportunity, evidence) "cerraduras sostenibles para gimnasios" — https://zentrylockers.com/cerraduras-inteligentes-taquillas/: Si se confirma este target como el correcto tras resolver la duplicidad con /cerraduras/, crear contenido de soporte sobre sostenibilidad aplicada a cerraduras de vestuarios/gimnasios.

### Problemas tecnicos (2)

- [high] https://zentrylockers.com/cerraduras/: Pagina en papelera con redireccion 301 activa a /cerraduras-para-taquillas/, pero sigue siendo el target de tareas SEO activas en el backlog (2 keywords, 51 impresiones combinadas) -- riesgo de trabajar sobre una URL muerta.
- [medium] https://zentrylockers.com/taquillas-melamina/, https://zentrylockers.com/taquillas-para-colegios/, https://zentrylockers.com/taquillas-para-empresas/, https://zentrylockers.com/taquillas-fenolicas/, https://zentrylockers.com/taquillas-para-hospitales/: CTR 0.00% sistematico en multiples paginas de producto/sector pese a impresiones reales -- indica snippets (title/meta description) poco atractivos a nivel de varias plantillas, no solo de una pagina puntual.

### Huecos de contenido (4)

- Taquillas para gimnasios (keyword relacionada: "taquillas para gimnasios"): Keyword objetivo comercial de prioridad alta en el catalogo estatico sin actionItem activo ni cluster catalogado con targetUrl -- no hay evidencia de contenido dedicado en este contexto.
- Lockers inteligentes (terminologia 'locker') (keyword relacionada: "lockers inteligentes"): Keyword objetivo comercial de prioridad alta; el cluster mas cercano (taquillas_inteligentes_general) solo cubre explicitamente la variante 'taquillas inteligentes', no 'lockers' -- posible gap terminologico no resuelto.
- Digitalizacion de taquillas (contenido informativo) (keyword relacionada: "digitalizacion de taquillas"): Keyword informativa de prioridad media en el catalogo estatico sin cluster ni actionItem asociado -- posible pieza de contenido informativo/blog no cubierta todavia.
- Publicacion de paginas nuevas ya aprobadas en staging (metalicas, vestuarios, universidades): Tres clusters new_page_candidate ya tienen staging visualmente aprobado (taquillas_metalicas, taquillas_vestuarios, taquillas_universidad), pendientes solo de pasar a produccion.

### Enlazado interno recomendado (3)

- https://zentrylockers.com/cerraduras-inteligentes-taquillas/ -> https://zentrylockers.com/cerraduras-para-taquillas/ ("ver catalogo de cerraduras ARES, ORBIS, BOXIS y NEO"): El cluster documenta que esta pagina informativa se diferencia deliberadamente de /cerraduras-para-taquillas/ (catalogo comercial); enlazar desde la version informativa a la comercial completa el recorrido de usuario sin fusionar contenido.
- https://zentrylockers.com/taquillas-melamina/ -> https://zentrylockers.com/taquillas-melamina-fenolico/ ("taquillas de melamina con puertas fenolicas"): Ambas paginas conviven deliberadamente como landings diferenciadas (generico vs combinacion especifica); un enlace contextual claro entre ambas refuerza la diferenciacion frente a la confusion/canibalizacion que se detecta en algunos action items actuales.
- https://zentrylockers.com/taquillas-para-empresas/ -> https://zentrylockers.com/taquillas-para-oficinas/ ("taquillas para oficinas"): Ambos clusters comparten cliente final B2B pero distinto entorno fisico (empresa generica vs oficina); un enlace cruzado ayuda a la navegacion sin fusionar los clusters, tal como documenta el catalogo.

### Acciones priorizadas (8)

| # | Titulo | Prioridad | Esfuerzo | Impacto |
|---|---|---|---|---|
| 1 | Corregir el enrutado de tareas hacia la pagina obsoleta /cerraduras/ (en papelera, con 301 a /cerraduras-para-taquillas/) | high | low | high |
| 2 | Cerrar/reenrutar los action items de melamina generica mal enrutados a /taquillas-melamina-fenolico/ segun la decision O29.1 ya aprobada | high | low | high |
| 3 | Decidir un cluster/target unico para 'cerraduras sostenibles para gimnasios' antes de crear contenido | medium | low | medium |
| 4 | Ejecutar los quick wins de on-page en paginas cercanas a top10 (cerraduras inteligentes para taquillas, taquillas colegios, cerraduras electronicas para taquillas, taquillas vestuarios de melamina, taquillas de melamina, taquillas para hospital, comprar taquillas para hospitales) | high | medium | medium |
| 5 | Revisar y reescribir meta titles/descriptions en las paginas con CTR 0% sistematico | medium | medium | medium |
| 6 | Publicar a produccion las paginas nuevas ya aprobadas en staging (taquillas metalicas, vestuarios, universidades) | medium | medium | high |
| 7 | Evaluar cobertura de contenido para keywords objetivo de alta prioridad sin cluster/actionItem (taquillas para gimnasios, lockers inteligentes) | medium | high | medium |
| 8 | Implementar el enlazado interno recomendado entre paginas diferenciadas (cerraduras informativo-comercial, melamina generico-fenolico, empresas-oficinas) | low | low | medium |

### Desconocidos (4)

- No se dispone de cifras exactas de clics por keyword mas alla de lo indicado en el rationale de cada action item (solo impresiones y posicion media); no puedo confirmar CTR exacto mas alla del 0.00% citado en algunos rationale.
- No hay informacion en este contexto sobre si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ejecuto sobre los action items de este run concreto -- no puedo confirmar si O5/O6 estan realmente pendientes de cierre o son residuales de una ejecucion anterior.
- No tengo acceso al contenido real de los informes en las rutas indicadas (seo-director-2026-08-17.md, seo-watcher-2026-08-17.md) mas alla de lo ya resumido en este contexto estructurado.
- No hay evidencia en este contexto sobre el estado de aprobacion final o fecha de publicacion prevista para las paginas de staging listadas (2103, 2104, 2105, 2110).

Auditoria: sin avisos (ninguna afirmacion sin respaldo detectada en el contexto suministrado).

## Confirmacion de seguridad

- No se ha modificado WordPress, Google Ads, GA4, GTM, n8n, Search Console ni qdrant.
- No se ha ejecutado ningun cambio SEO real; este empleado solo lee datos ya persistidos localmente y propone.
- No se han impreso ni registrado secretos en este informe ni en los logs de esta ejecucion.
