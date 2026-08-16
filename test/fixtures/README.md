# Fixtures congelados de pasadas REALES

## `dept-2026-08-16T134942Z-*`

Pasada coordinada real del 2026-08-16 (GitHub Actions run `31950916906`),
la que motivo este trabajo: SEO/Growth/QA/Web Engineer todos en
`executed`/`pass_with_warnings`, **9 cambios propuestos, 0 ChangePlans
declarados, 0 ACTIONABLE, 0 escrituras**.

| Fichero | Que es | Procedencia |
| --- | --- | --- |
| `dept-2026-08-16T134942Z-web-engineer-context.json` | El `DepartmentWebEngineerContext` EXACTO que recibio `web-engineer` (8 recomendaciones aprobadas + 44 paginas de inventario real de staging). | Extraido literalmente del prompt del run `31950916906`. |
| `dept-2026-08-16T134942Z-web-engineer-output.json` | La salida de `web-engineer` en esa pasada. | Reconstruida desde `apply-summary.json` volcado al log de ese run. |

### Limitaciones conocidas de estos ficheros (importantes al leer un replay)

- **El contexto es del contrato ANTERIOR al fix**: no trae
  `recommendationId`, ni `resolvedTargets[]`, ni `targetPageSnapshots[]`.
  `scripts/replay-web-engineer-changeplans.ts` los deriva al vuelo con la
  MISMA funcion que usa la pasada real
  (`resolveRecommendationTargetFields`), justamente para poder comparar
  antes/despues sobre el mismo input.
- **El inventario congelado son `StagingPageBrief`, no snapshots
  completos**: llevan id, slug, URL, status, title, excerpt y
  `versionHash`, pero NO el `post_content`. El replay reconstruye el
  inventario con `contentHtml: ""`, asi que en replay un
  `update_post_content` cae -- correctamente -- en `missing_before`, y el
  `expectedBeforeHash` que calcularia NO es el de la pagina real. El
  replay sirve para diagnosticar resolucion de pagina/BEFORE/AFTER, no
  para producir un plan ejecutable.
- **La salida es una reconstruccion parcial**: solo 5 de los 9
  `proposedChanges` sobreviven en el `apply-summary.json` (los otros 4 no
  quedaron atribuidos a ninguna recomendacion), y
  `filesOrSystemsAffected` / `dependencies` / `risks` / `unknowns` no se
  volcaron. Lo unico que el replay necesita de ella es el hecho central y
  verificado en el log del run: **`changePlans` ausente**.
- El artifact completo del run (`zentry-ai-department-dept-2026-08-16T134942Z`)
  sigue en GitHub Actions con 90 dias de retencion; estos ficheros
  existen para poder iterar sin depender de el.
