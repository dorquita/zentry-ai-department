# Brief de estrategia de contenido — 353d3c9d-b9a6-428e-a900-423236a95902

- **Generado:** 2026-08-17T20:28:04.943Z
- **Keyword:** colegio
- **Marca:** both | **brandIntent:** mixed_cross_sell
- **Tipo de contenido (hint del pipeline determinista):** Landing nueva

**No se ha publicado ningun contenido. Este brief es solo una propuesta estrategica para revision humana.**

## Estado: brief completado

- **Oportunidad:** Landing sectorial 'Colegio': mobiliario escolar (Zentry) + control de acceso (Tukandado) — La keyword 'colegio' capta un segmento B2B claro (centros educativos) pero no especifica si el interes es mueble o cerradura, por lo que conviene una landing que autoclasifique al visitante antes de derivarlo a la solucion correcta.
- **Audiencia objetivo:** Responsable de administracion, direccion o mantenimiento de un colegio que gestiona la compra de taquillas para alumnado/vestuarios y/o el control de acceso a esas taquillas u otros espacios del centro.
- **Intencion de busqueda:** commercial | **Intencion comercial:** Captar trafico de centros educativos en fase de evaluacion de proveedor (mobiliario y/o cerraduras) y convertirlo en solicitud de presupuesto para Zentry, informacion/demo para Tukandado, o ambas.
- **Angulo:** En vez de asumir que quien busca 'colegio' ya sabe si necesita mueble, cerradura o ambos, la landing empieza autoclasificando la necesidad (siguiendo el H2 ya propuesto) y solo despues presenta cada solucion con datos reales de catalogo aplicados a contextos escolares tipicos (aulas, vestuarios, gimnasio del centro) -- evita generalizar sobre 'colegios' sin dar informacion util especifica al contexto escolar.
- **Tipo de contenido:** new_landing | **Marca:** mixed | **Prioridad:** medium

### Estructura propuesta

**H1:** Taquillas y cerraduras para colegios

- H2: ¿Buscas mueble, cerradura o ambos? — Resolver la ambiguedad de la keyword 'colegio' (no especifica producto) ayudando al visitante a autoclasificarse y reducir el rebote derivandolo a la seccion relevante.
- H2: Solucion Zentry: taquillas para colegios — Presentar el mobiliario Zentry orientado a centros educativos, enlazando con la subseccion de materiales.
- H3: Materiales recomendados segun la zona del colegio — Explicar de forma condicional (segun zona, no como afirmacion universal) que melamina encaja en aulas/zonas secas, fenolica en vestuarios/duchas deportivas del centro y metalica en zonas de alto trafico, usando solo el catalogo de materiales confirmado.
- H2: Solucion Tukandado: cerraduras electronicas para taquillas escolares — Presentar los metodos de apertura confirmados (mecanica, PIN, tarjeta/RFID, app segun modelo) como opcion para taquillas de colegio, dejando claro que las funciones dependen del modelo, sin prometer registro de accesos como algo universal.
- H2: Como elegir segun tu caso — Tabla comparativa mecanica vs electronica (segun la estructura visual esperada de marca) para ayudar a decidir en funcion de necesidad de control de uso, mantenimiento y presupuesto, cerrando con CTA.

### CTA

- **Principal:** Ver taquillas para colegios y solicitar presupuesto sin compromiso
- **Secundario:** Ver cerraduras electronicas y solicitar informacion
- **Razonamiento:** El CTA doble propuesto por el pipeline (recommendedCtaHint) encaja con la ambiguedad de intencion detectada en brandRationale: al no saber si el visitante busca mueble, cerradura o ambos, se ofrecen las dos rutas de conversion en vez de forzar una sola.

### Enlaces internos propuestos

- Ver catalogo de taquillas Zentry -> Contenido/landing de mobiliario Zentry (segun internalLinkHints, sin URL real disponible en el contexto) (sin URL real todavia)
- Ver cerraduras electronicas Tukandado -> Contenido/landing de cerraduras Tukandado (segun internalLinkHints, sin URL real disponible en el contexto) (sin URL real todavia)
- Taquillas y cerraduras para colegios (variante plural) -> Posible pagina/keyword 'colegios' senalada en clusterNote como riesgo de canibalizacion -- enlazar o consolidar segun se decida, no crear como pieza aislada (sin URL real todavia)

### Evidencia de soporte

- currentAssumptions confirma que 'se asume que colegio sigue siendo relevante para Zentry y Tukandado', pero como asuncion, no como dato verificado -- se refleja en el angulo de autoclasificacion en vez de asumir intencion de compra especifica.
- clusterNote indica explicitamente 'Posible cluster SEO con: colegios. Considerar enlazado interno entre estas paginas', lo que respalda tratar 'colegio' y 'colegios' como piezas relacionadas a coordinar, no independientes.
- brandRationale del contexto ya señala que la keyword 'no menciona explicitamente taquilla ni cerradura' pero tiene 'senal B2B detectada: colegio', lo que justifica el enfoque mixto (targetBrand mixed) y el CTA doble.
- secondaryKeywords solo aporta 'colegios' (variante plural), sin mas señales de intencion transaccional especifica dentro del contexto recibido.

### Riesgos / incognitas

- Riesgo de canibalizacion SEO con la keyword/pagina 'colegios' ya senalado en risks y clusterNote -- publicar esta landing sin coordinar el enlazado o consolidar contenido puede competir por la misma intencion de busqueda.
- La keyword 'colegio' por si sola es muy generica y no confirma intencion transaccional real (no menciona producto); existe el riesgo de que el trafico que capte sea mayoritariamente informacional/navegacional y no convierta como se espera.
- brandRationale marca explicitamente que 'requiere revision manual para decidir Zentry vs Tukandado' -- el peso 50/50 entre marcas propuesto aqui deberia validarse antes de publicar.
- Precedente relevante de decisiones humanas anteriores: se rechazo publicar en produccion otras landings nuevas ya aprobadas en staging (universidades, metalicas, vestuarios, taquillas inteligentes) porque 'se ven demasiado basicas y sin suficientes imagenes/fotografias' y necesitan 'una segunda iteracion visual y de contenido' -- esta landing es del mismo tipo (landing nueva, cross-sell mixto) y corre el mismo riesgo si se entrega sin suficiente refuerzo visual antes de pasar a produccion.
- No se recibio un valor de 'page' en el contexto, por lo que no existe ninguna URL real disponible para marcar isRealLink como true en el enlazado interno -- debera asignarse una URL real antes de publicacion.

**reasoningNotes (justificacion del subagente, no auto-evaluacion):**

- Se mantiene el angulo de autoclasificacion del proposedStructureHint (H2 '¿Buscas mueble, cerradura o ambos?') como punto de partida porque responde directamente a la ambiguedad que el propio brandRationale reconoce ('no menciona explicitamente taquilla ni cerradura'), en vez de forzar un angulo mas comercial que asumiria una intencion que el contexto no confirma.
- Se amplio la estructura con una subseccion H3 de materiales aplicados a zonas del colegio (aulas, vestuarios, gimnasio) porque aporta valor informativo real usando exclusivamente el catalogo de materiales/metodos de apertura CONFIRMADO de la skill, sin inventar ninguna caracteristica especifica de producto para colegios que no venga en el contexto.
- priority se mantiene en 'medium' (heredado del contexto) en vez de subirla, dado el riesgo de canibalizacion con 'colegios' aun sin resolver y el precedente de rechazo humano a landings nuevas similares por falta de acabado visual -- subir prioridad antes de resolver ambos puntos parecia prematuro.
- No se incluyo ninguna afirmacion de 'fabricante directo', garantia o plazos de entrega porque currentAssumptions no las confirma para esta pagina -- el CTA remite a 'solicitar presupuesto'/'solicitar informacion' en lugar de prometer datos concretos, siguiendo la regla anti-fabricacion de la skill.

> ⚠️ Auditoria: 1 aviso(s) para revision humana:
> - Afirmacion sensible no respaldada (fabricante directo / sin intermediarios): "fabricante directo" en "No se incluyo ninguna afirmacion de 'fabricante directo', garantia o plazos de e..." -- el brief de entrada no lo confirma (o lo marca como pendiente de confirmar).

_Artefacto de solo lectura/propuesta. Ningun brief de este empleado se ha publicado en WordPress, Google Ads, GA4, GTM, n8n ni qdrant. La redaccion del contenido final (nunca generada por defecto por este empleado) y la decision de publicar las hace un humano por fuera de este sistema._
