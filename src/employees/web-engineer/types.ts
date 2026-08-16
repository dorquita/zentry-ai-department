/**
 * Interfaz TypeScript del contrato de salida del subagente Claude
 * `web-engineer` -- ver .claude/agents/web-engineer.md ("Que debes
 * producir") y config/web-engineer-output.schema.json (el JSON Schema
 * equivalente, pasado a claude-code-action via --json-schema). Ambos
 * deben mantenerse en el MISMO commit (ver
 * test/web-engineer-output-schema.test.ts, que verifica que no hay
 * deriva entre los dos).
 *
 * `approvalRequired` se tipa como `boolean` (no como literal `true`) a
 * proposito: el TYPE no puede impedir que Claude devuelva `false` -- esa
 * regla de negocio la aplica `validateWebEngineerOutput()` en
 * validator.ts, de forma explicita y con un mensaje de error especifico,
 * no silenciosamente via el sistema de tipos.
 */
export interface WebEngineerProposedChange {
  description: string;
  rationale: string;
  targetPageOrComponent: string;
}

/**
 * Plan de cambio EJECUTABLE declarado por web-engineer. Deliberadamente
 * NO tiene `pageId` ni `expectedBeforeHash`: esos los resuelve
 * `buildChangePlanFromDraft()` contra el inventario REAL de staging. Si
 * el modelo los aportara, se ignorarian.
 */
export interface WebEngineerChangePlanEntry {
  recommendationId: string;
  /** URL de staging o slug EXACTOS, copiados del inventario. */
  targetPage: string;
  operation: "update_post_content" | "update_post_title" | "update_post_excerpt" | "update_post_meta";
  /** Contenido nuevo COMPLETO del campo. */
  newValue: string;
  metaKey?: "_yoast_wpseo_title" | "_yoast_wpseo_metadesc";
  rationale: string;
}

export interface WebEngineerOutput {
  implementationSummary: string;
  targetPages: string[];
  targetComponents: string[];
  proposedChanges: WebEngineerProposedChange[];
  filesOrSystemsAffected: string[];
  acceptanceCriteria: string[];
  validationPlan: string[];
  rollbackPlan: string[];
  dependencies: string[];
  risks: string[];
  approvalRequired: boolean;
  unknowns: string[];
  /**
   * OPCIONAL y aditivo: una salida sin `changePlans` sigue siendo valida
   * (es exactamente lo que produce el modelo cuando no puede resolver
   * ninguna pagina con evidencia real, y ese es el resultado correcto,
   * no un fallo).
   */
  changePlans?: WebEngineerChangePlanEntry[];
}
