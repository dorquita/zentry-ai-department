# QA Reviewer -- revision de generic_json_artifact (dept-2026-08-17T230452Z-qa-input)

- **Generado:** 2026-08-17T23:25:10.100Z
- **sourceEmployee:** unknown
- **artifactPath:** `reports/department/dept-2026-08-17T230452Z/dept-2026-08-17T230452Z-qa-input.json`

**qa-reviewer no vuelve a hacer el trabajo original ni aplica correcciones -- solo evalua.**

## Resultado

- **reviewStatus:** `fail`
- **overallPass:** no | **hasWarnings:** si
- **findings:** 9 (critical: 1, warning: 7, info: 1)
- **approvalRecommendation:** `pending` (riesgo: `high`)

**Resumen:** La pasada aporta hallazgos SEO, de contenido y de analytics bien evidenciados y una sintesis de growth mayormente cuidadosa (identifica y mitiga la contradiccion de canibalizacion de melamina, respeta la ausencia de sem-specialist en la mayoria de su output). Sin embargo, se detecta un fallo critico: growth.output.dependencies introduce un dato de SEM ('70 candidatas SEM') pese a que sem-specialist esta explicitamente fuera de esta fase, violando la instruccion explicita de no asumir ningun dato de Ads. Ademas, dos recomendaciones de growth que escriben contenido en produccion (quick win on-page y reescritura de metas CTR 0%) carecen de un gate explicito de aprobacion humana sobre el copy final, y existe una contradiccion no resuelta entre seo-specialist y growth sobre el estado de aprobacion visual de tres paginas en staging. Se recomienda revision humana antes de promover cualquier recomendacion a ejecucion.

### Findings

| Categoria | Severidad | Descripcion |
|---|---|---|
| fabrication_risk | critical | growth.output.dependencies incluye la entrada 'sem-watcher (V1 deterministico)' con la nota 'provee 70 candidatas SEM pero sin sintesis de sem-specialist encima'. Esto introduce un dato concreto de SEM/Ads pese a que artifact.semStatus.status='not_available' y las reviewInstructionsForQa prohiben explicitamente asumir 'gasto, CPC, impresiones, campanas activas ni ningun otro dato de Ads'. No existe ninguna entrada en growth.output.evidence que respalde la cifra '70 candidatas SEM'. |
| unsafe_actions | warning | growth.output.recommendedPriorities[2] ('Ejecutar el quick win aprobado de on-page en cerraduras inteligentes para taquillas') tiene dependsOn=[] pese a proponer edicion de contenido en produccion (H1/H2, enlazado interno, meta), apoyandose solo en una aprobacion generica de una pasada anterior (dept-2026-08-15T175321Z) para 'la iniciativa', no para el copy concreto que se publicaria. |
| unsafe_actions | warning | growth.output.recommendedPriorities[3] ('Reescribir meta title/description en las paginas con CTR 0% sistemico') solo condiciona la ejecucion a la secuencia (cerrar prioridades 1 y 2), no a una revision humana explicita del contenido final de los nuevos meta title/description antes de publicarlos en al menos 8 paginas de produccion. |
| contradictions | warning | seo-specialist.output.findings[4] (f5), opportunities opp17-opp19 y prioritizedActions[4] (rank 5) afirman que las paginas de staging de taquillas metalicas (2105), universidad (2110) y vestuarios (2104) estan 'visualmente aprobadas' y 'listas para pasar a produccion', mientras que growth.output.evidence ('human-decision-staging-publish-rejected') cita una decision humana literal que RECHAZO exactamente esa publicacion por 'verse demasiado basicas y sin suficientes imagenes/fotografias'. La informacion de seo-specialist sobre el estado de aprobacion visual de esas staging parece desactualizada frente a la de growth. |
| contradictions | warning | content-strategist.output.supportingEvidence cita una 'Decision humana previa ya aprobada: Cerrar los actionItems de canibalizacion de taquillas melamina...' como base para tratar el riesgo como ya gestionado, mientras seo-specialist.output.findings[1] (f2) documenta que los actionItems de 'taquillas melamina'/'taquillas de melamina' hacia /taquillas-melamina-fenolico/ siguen activos en esta misma pasada. growth.output mitiga esto correctamente (confianza rebajada a media, dependsOn de verificacion en priorities 2 y 7), pero la contradiccion de fondo entre ambos especialistas sigue sin resolverse dentro del artifact. |
| evidence_coverage | warning | growth.output usa evidenceRefs sinteticos (p.ej. 'dept-seo-technical-issue-1', 'dept-content-summary', 'dept-analytics-tracking-issue-1', 'dept-seo-action-1') que no coinciden literalmente con ningun id real presente en seo-specialist.output (t1/f1/opp1/ev1), content-strategist.output o analytics-specialist.output (E1). Esto rompe la trazabilidad mecanica de las citas de growth hacia los datos que supuestamente respaldan cada afirmacion. |
| unsupported_claims | warning | seo-specialist.output.executiveSummary afirma 'con datos live de Search Console de esta misma pasada (36 jobs, 0h de antiguedad)', pero seo-specialist.output.evidence solo contiene 19 entradas con source='job_data' (ev1-ev19); la cifra de 36 jobs no esta respaldada por ninguna evidencia listada en el propio artifact. |
| unsupported_claims | warning | growth.output.dependencies (entrada 'qa-reviewer') afirma '20/21 borradores pasan, 2 warnings' (staging-qa-agent V1) sin que exista ninguna entrada correspondiente en growth.output.evidence que respalde esa cifra. |
| approval_requirements | info | El artifact se declara explicitamente como propuesta de solo lectura no aplicada ('Ninguna parte de este artifact se ha aplicado a ningun sistema'), y la mayoria de recommendedPriorities de alto impacto (1, 2, 5, 6, 7) si incluyen dependsOn claros que exigen decision/verificacion humana antes de ejecutar, lo cual es buena practica. |

### Unsupported claims

- seo-specialist.output.executiveSummary: '36 jobs, 0h de antiguedad' no coincide con las 19 entradas source=job_data en seo-specialist.output.evidence.
- growth.output.dependencies (qa-reviewer): '20/21 borradores pasan, 2 warnings' sin evidenceRef ni entrada en growth.output.evidence que lo respalde.
- growth.output.dependencies (sem-watcher V1 deterministico): '70 candidatas SEM' -- dato de Ads/SEM sin ninguna evidencia dentro del artifact y pese a que sem-specialist esta explicitamente fuera de esta fase (semStatus.status='not_available').

### Contradictions

- content-strategist.output.supportingEvidence asume la canibalizacion de melamina ya resuelta ('Decision humana previa ya aprobada: Cerrar los actionItems...') mientras seo-specialist.output.findings f2 encuentra esos mismos actionItems ('taquillas melamina'/'taquillas de melamina' -> /taquillas-melamina-fenolico/) todavia activos en esta misma pasada.
- seo-specialist.output.findings f5 / opportunities opp17-opp19 / prioritizedActions rank5 afirman que las paginas de staging (taquillas metalicas 2105, universidad 2110, vestuarios 2104) estan 'visualmente aprobadas' y listas para publicar, mientras growth.output.evidence ('human-decision-staging-publish-rejected') documenta un rechazo humano literal de exactamente esa publicacion por calidad visual/fotografica insuficiente.

### Safety concerns

- growth.output.recommendedPriorities[2] 'Ejecutar el quick win aprobado de on-page en cerraduras inteligentes para taquillas' tiene dependsOn=[] y propone escribir contenido (H1/H2, meta, enlazado interno) en una pagina de produccion apoyandose solo en una aprobacion generica de una pasada anterior (dept-2026-08-15T175321Z), sin exigir revision/aprobacion explicita del copy final antes de publicar.
- growth.output.recommendedPriorities[3] 'Reescribir meta title/description en las paginas con CTR 0% sistemico' propone reescribir meta tags en al menos 8 paginas de produccion sin exigir explicitamente una revision/aprobacion humana del contenido final antes de publicar, mas alla de la secuencia con las prioridades 1 y 2.
- growth.output.dependencies introduce el dato de SEM/Ads '70 candidatas SEM' (sem-watcher V1) pese a que sem-specialist esta explicitamente fuera de esta fase; si esta cifra se usara como senal valida en decisiones posteriores sin sintesis ni validacion real de sem-specialist, se estaria actuando sobre un dato de Ads no verificado ni aprobado en este contexto.

### Required corrections

- Eliminar o respaldar con una evidencia trazable la referencia a '70 candidatas SEM' en growth.output.dependencies (sem-watcher), ya que introduce un dato de Ads pese a que sem-specialist esta fuera de esta fase y no hay ninguna evidencia que lo respalde en el artifact.
- Anadir a growth.output.recommendedPriorities[2] ('Ejecutar el quick win aprobado de on-page en cerraduras inteligentes para taquillas') un dependsOn explicito que exija revision/aprobacion humana del copy final antes de publicar en produccion.
- Anadir a growth.output.recommendedPriorities[3] ('Reescribir meta title/description en las paginas con CTR 0% sistemico') un dependsOn explicito que exija revision/aprobacion humana del contenido final de cada meta antes de publicar.
- Senalar explicitamente en growth.output (o corregir en seo-specialist.output.findings f5 / opp17-opp19 / prioritizedActions rank5) que la publicacion de las staging de taquillas metalicas/universidad/vestuarios fue previamente rechazada por un humano por calidad visual, para que no se lea como lista para publicar.
- Corregir o respaldar con una entrada de evidence la cifra '36 jobs, 0h de antiguedad' del executiveSummary de seo-specialist, dado que solo hay 19 entradas source=job_data en su propio array de evidence.
- Sustituir las evidenceRefs sinteticas de growth (dept-seo-technical-issue-N, dept-content-summary, dept-analytics-tracking-issue-N, dept-seo-action-N, dept-analytics-action-N, etc.) por los ids reales usados en los outputs de los especialistas (t1/f1/opp1/ev1 para SEO, E1 para analytics) para permitir verificacion mecanica de cada cita.
- Respaldar con una entrada de evidence la cifra '20/21 borradores pasan, 2 warnings' citada en growth.output.dependencies (qa-reviewer).

### Approval recommendation

- **recommendedStatus:** `pending`
- **riskLevel:** `high`
- **rationale:** El artifact combina hallazgos SEO/content/analytics de buena calidad y bien evidenciados, con una sintesis de growth que en general prioriza y caveatea de forma razonable, pero contiene un fallo critico (referencia a un dato de SEM/'70 candidatas SEM' pese a que sem-specialist esta explicitamente fuera de esta fase) y dos recomendaciones de escritura en produccion sin gate explicito de aprobacion humana sobre el contenido final. Ademas hay contradicciones internas (canibalizacion de melamina, estado de aprobacion visual de las staging) que, aunque parcialmente mitigadas por growth, requieren verificacion humana antes de promover cualquier accion a ejecucion.

### Evidence

- growth.output.dependencies: entrada 'sem-watcher (V1 deterministico)' -> nota 'provee 70 candidatas SEM pero sin sintesis de sem-specialist encima', pese a artifact.semStatus.status='not_available'.
- seo-specialist.output.executiveSummary: '36 jobs, 0h de antiguedad' vs seo-specialist.output.evidence con solo 19 entradas source='job_data' (ev1-ev19).
- seo-specialist.output.findings[1] (f2): actionItems de 'taquillas melamina'/'taquillas de melamina' apuntan a /taquillas-melamina-fenolico/ pese a la decision O29.1.
- content-strategist.output.supportingEvidence[2]: "Decision humana previa ya aprobada: 'Cerrar los actionItems de canibalizacion de taquillas melamina y revisar la aprobacion critica pendiente relacionada'".
- seo-specialist.output.findings[4] (f5) y prioritizedActions[4] (rank 5): staging 'visualmente aprobada, listas para pasar a produccion' vs growth.output.evidence 'human-decision-staging-publish-rejected': "Las paginas de staging todavia se ven demasiado basicas y sin suficientes imagenes/fotografias...".
- growth.output.recommendedPriorities[2].dependsOn = [] para 'Ejecutar el quick win aprobado de on-page en cerraduras inteligentes para taquillas'.
- growth.output.recommendedPriorities[3].dependsOn solo referencia secuencia, no aprobacion del contenido, para 'Reescribir meta title/description en las paginas con CTR 0% sistemico'.
- growth.output.recommendedPriorities y currentSignals usan evidenceRefs como 'dept-seo-technical-issue-1', 'dept-content-summary' que no coinciden con ningun id literal (t1/f1/opp1/ev1) en seo-specialist.output ni content-strategist.output.
- growth.output.dependencies (qa-reviewer): '20/21 borradores pasan, 2 warnings' sin evidenceRef asociado en growth.output.evidence.

_Artefacto de solo lectura/revision. qa-reviewer no vuelve a hacer el trabajo original ni aplica ninguna correccion -- solo evalua el artifact ya producido. La decision de aplicar/rechazar cualquier correccion la toma un humano._
