# QA Reviewer -- revision de generic_json_artifact (dept-2026-08-17T234302Z-qa-input)

- **Generado:** 2026-08-18T00:02:57.629Z
- **sourceEmployee:** unknown
- **artifactPath:** `reports/department/dept-2026-08-17T234302Z/dept-2026-08-17T234302Z-qa-input.json`

**qa-reviewer no vuelve a hacer el trabajo original ni aplica correcciones -- solo evalua.**

## Resultado

- **reviewStatus:** `fail`
- **overallPass:** no | **hasWarnings:** si
- **findings:** 6 (critical: 2, warning: 2, info: 2)
- **approvalRecommendation:** `pending` (riesgo: `high`)

**Resumen:** Los tres especialistas (seo, content, analytics) entregan analisis bien fundamentados, con basis explicito (evidence/inference, FACT/OBSERVATION/HYPOTHESIS) y evidenceRefs verificables dentro de sus propios outputs. Sin embargo, la sintesis de growth-director-v2 presenta dos problemas criticos: introduce una cifra de SEM ('70 candidatas') pese a que sem-specialist esta explicitamente ausente, y justifica seis recomendaciones de ejecucion en produccion citando repetidamente una 'aprobacion humana' narrativa sin ningun identificador verificable, lo que contradice la propia afirmacion del artifact de que nada se ha aplicado aun a ningun sistema. Ademas existe una contradiccion sin resolver entre seo-specialist (staging ya aprobada visualmente) y growth (staging rechazada por un humano por falta de calidad visual), y los evidenceRefs de growth no trazan a ningun id real del artifact. Se recomienda revision humana antes de promover cualquiera de las recomendaciones de ejecucion directa citadas."

### Findings

| Categoria | Severidad | Descripcion |
|---|---|---|
| fabrication_risk | critical | growth.output.dependencies['sem-watcher (V1 deterministico)'].note afirma 'connected=true en el ultimo agent_finished, con 70 candidatas SEM, no incluidas en este contexto', pese a que semStatus.status='not_available' y las reviewInstructionsForQa prohiben expresamente asumir cualquier dato de SEM/Ads. Esta cifra concreta no aparece respaldada en ningun otro lugar del artifact. |
| approval_requirements | critical | Seis de las nueve recommendedPriorities de growth (titulos 1,2,3,4,5,8) citan 'ya aprobado por un humano el 2026-08-16' apoyandose unicamente en growth.output.evidence[0], una descripcion narrativa autoria de growth sin approvalRequestId ni ningun otro dato verificable. Varias de esas recomendaciones usan literalmente el verbo 'ejecutar' (p.ej. 'Confirmar y ejecutar la correccion definitiva del enrutado de /cerraduras/', 'Ejecutar el quick win on-page de cerraduras inteligentes para taquillas'), lo que contradice la propia afirmacion del artifact de que 'ninguna parte de este artifact se ha aplicado a ningun sistema: es una propuesta de solo lectura'. |
| contradictions | warning | seo-specialist (opportunities o11, o12, o13 y evidence ev-gap-uni, ev-gap-met, ev-gap-vest) afirma que las paginas de staging de universidades, metalicas y vestuarios ya estan 'aprobada visualmente' y recomienda publicarlas, mientras growth.output.risks[0] y recommendedPriorities[6] afirman que un humano ya rechazo esa misma publicacion el 2026-08-16 'por falta de calidad visual'. El artifact no aclara cual de las dos afirmaciones es la vigente. |
| evidence_coverage | warning | Los evidenceRefs usados en growth.output.currentSignals, bottlenecks, opportunities, experiments, recommendedPriorities y risks (p.ej. 'dept-seo-technical-issue-1', 'dept-analytics-action-1', 'dept-content-cta') no coinciden con ningun id real presente en los outputs de los especialistas (que usan ids como ti1, f1-f7, o1-o15, e1-e21) ni con las dos unicas entradas de growth.output.evidence, rompiendo la trazabilidad de la sintesis de growth hacia la evidencia subyacente. |
| missing_assumptions | info | growth.growthSummary da por vigente el 'historial de decisiones humanas' del 2026-08-16 sin declarar explicitamente el supuesto de que nada ha cambiado desde entonces; el propio seo-specialist.unknowns ya señala que 'no se conoce si el script scripts/o291-resolve-melamina-cannibalization.ts ya se ha ejecutado en este run o sigue pendiente'. |
| actionability | info | Los tres outputs de especialistas (seo-specialist, content-strategist, analytics-specialist) etiquetan de forma consistente cada afirmacion con basis/claimType (evidence/inference, FACT/OBSERVATION/HYPOTHESIS/RECOMMENDATION) y anclan sus recomendaciones a evidenceRefs verificables dentro de su propio output, lo cual facilita la accionabilidad de esa capa. |

### Unsupported claims

- growth.output.dependencies['sem-watcher (V1 deterministico)'].note: 'connected=true en el ultimo agent_finished, con 70 candidatas SEM, no incluidas en este contexto' -- cifra de SEM sin respaldo en el artifact pese a que sem-specialist tiene status not_available.
- growth.output.recommendedPriorities[0,1,2,3,4,7].dependsOn/evidenceRefs: multiples afirmaciones de 'ya aprobado por un humano el 2026-08-16' respaldadas unicamente por la descripcion narrativa que el propio growth escribe en growth.output.evidence[0], sin identificador de aprobacion verificable.

### Contradictions

- seo-specialist opportunities o11/o12/o13 y evidence ev-gap-uni/ev-gap-met/ev-gap-vest afirman que las staging de universidades, metalicas y vestuarios 'ya estan aprobada visualmente' y recomiendan publicarlas, mientras growth.output.risks[0] afirma que 'un humano ya rechazo esa publicacion... por falta de calidad visual' el 2026-08-16 -- ambas afirmaciones no pueden ser simultaneamente correctas sin mas contexto que el artifact no aporta.

### Safety concerns

- Multiples recommendedPriorities de growth (p.ej. 'Confirmar y ejecutar la correccion definitiva del enrutado de /cerraduras/', 'Ejecutar el quick win on-page de cerraduras inteligentes para taquillas', 'Cerrar la canibalizacion melamina vs melamina-fenolico en el backlog', 'Reescribir meta title/description en paginas con CTR 0% e impresiones reales') se presentan como ya autorizadas para ejecucion citando 'un humano ya aprobo el 2026-08-16', sin ningun approvalRequestId ni dato verificable en el artifact -- de tomarse al pie de la letra, podria llevar a escribir en produccion/WordPress/GTM sin pasar por una aprobacion humana explicita y trazable en este run concreto.
- growth.output.dependencies afirma la existencia de '70 candidatas SEM' pese a que sem-specialist esta explicitamente fuera de esta fase (not_available); si esta cifra se usa para alimentar decisiones cross-channel futuras, se estaria actuando sobre un dato no verificado ni presente en ninguna otra parte del artifact.

### Required corrections

- Aportar en growth.output un identificador de aprobacion verificable (approvalRequestId, timestamp de sistema de aprobaciones, o referencia cruzada) para cada recomendacion que cite 'ya aprobado por un humano el 2026-08-16', en vez de reutilizar una unica descripcion narrativa en seis recomendaciones distintas.
- Eliminar o justificar con fuente real la cifra '70 candidatas SEM' en growth.output.dependencies, dado que sem-specialist tiene status not_available y las instrucciones de revision prohiben asumir datos de SEM.
- Resolver explicitamente la contradiccion entre seo-specialist (staging de universidades/metalicas/vestuarios ya aprobada visualmente, recomienda publicar) y growth (afirma que un humano ya rechazo esa publicacion por falta de iteracion visual) antes de promover cualquier recomendacion relacionada con estas 4 paginas.
- Corregir los evidenceRefs de growth.output (currentSignals, bottlenecks, opportunities, experiments, recommendedPriorities, risks) para que apunten a ids reales existentes en los outputs de los especialistas (ti1, f1-f7, o1-o15, e1-e21) o en growth.output.evidence, en vez de identificadores inventados como 'dept-seo-action-1' que no aparecen en ningun otro lugar del artifact.

### Approval recommendation

- **recommendedStatus:** `pending`
- **riskLevel:** `high`
- **rationale:** El artifact combina propuestas legitimas y bien fundamentadas de los tres especialistas con una capa de sintesis de growth que introduce dos problemas serios: (1) una cifra de SEM ('70 candidatas') no respaldada pese a que sem-specialist esta explicitamente fuera de esta fase, y (2) el uso repetido de una supuesta aprobacion humana generica ('2026-08-16') sin identificador verificable para justificar 'ejecutar' cambios en produccion (routing, contenido on-page, metas, scripts de canibalizacion). Ademas existe una contradiccion sin resolver sobre si las 3 paginas de staging estan realmente aprobadas visualmente o fueron rechazadas por un humano. Se requiere intervencion humana para verificar la cadena de aprobaciones real antes de promover cualquiera de las recomendaciones de ejecucion directa.

### Evidence

- growth.output.dependencies['sem-watcher (V1 deterministico)'].note: 'connected=true en el ultimo agent_finished, con 70 candidatas SEM, no incluidas en este contexto.'
- growth.output.evidence[0].description: 'el 2026-08-16 se aprobaron sin motivo textual adicional las propuestas de resolver el enrutado de /cerraduras/, cerrar la canibalizacion de melamina, ejecutar el quick win de cerraduras inteligentes para taquillas, reescribir metas con CTR 0%, validar click_phone, y coordinar el contenido de Taquillas Inteligentes con el cluster SEO.'
- seo-specialist.opportunities[10].rationale (o11): 'No existe pagina de produccion equivalente; el cluster catalog ya valido el hueco y la staging esta visualmente aprobada.'
- growth.output.risks[0].description: 'seo-specialist recomienda publicar a produccion las 3 paginas de staging, accion ya rechazada por un humano el 2026-08-16 por falta de calidad visual.'
- growth.output.currentSignals[0].evidenceRefs: ['dept-seo-technical-issue-1','dept-seo-action-1'] -- ids que no coinciden con ningun id real en seo-specialist.output (ti1, f1, o1, etc.).
- reviewInstructionsForQa: 'Ninguna parte de este artifact se ha aplicado a ningun sistema: es una propuesta de solo lectura.'
- semStatus.status: 'not_available'.

_Artefacto de solo lectura/revision. qa-reviewer no vuelve a hacer el trabajo original ni aplica ninguna correccion -- solo evalua el artifact ya producido. La decision de aplicar/rechazar cualquier correccion la toma un humano._
