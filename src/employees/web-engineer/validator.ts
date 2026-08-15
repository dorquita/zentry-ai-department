import { WebEngineerContext } from "./context";
import { WebEngineerOutput, WebEngineerProposedChange } from "./types";

/**
 * Validador/auditor de dominio del empleado `web-engineer` -- mismo
 * patron que validateV2Output()/auditV2OutputForFabrication() en
 * src/core/landing-architect-comparison.ts. Recibe el `unknown` ya
 * validado contra config/web-engineer-output.schema.json por el runtime
 * comun (src/core/claude-employee-runtime.ts) -- nunca al reves.
 *
 * Dos funciones con autoridad distinta a proposito:
 *   - validateWebEngineerOutput(): fail-closed, LANZA ante cualquier
 *     forma invalida O ante approvalRequired !== true. Esta segunda
 *     condicion es una regla ESTRUCTURAL de esta fase (ver mision en
 *     .claude/agents/web-engineer.md): ningun output de este empleado
 *     puede saltarse la aprobacion humana, nunca -- por eso se trata
 *     como fallo de validacion, no como aviso.
 *   - auditWebEngineerOutputForUnconfirmedCapabilities(): NO lanza,
 *     devuelve warnings para revision humana -- red de seguridad
 *     textual (no NLP real) que detecta afirmaciones confiadas sobre
 *     existencia de plugins/temas/APIs (categorias que este proyecto
 *     JAMAS puede confirmar, ver context.ts,
 *     NO_PLUGIN_THEME_API_INVENTORY_NOTICE) o de paginas no confirmadas
 *     por `confirmedExistingPageUrls`.
 */

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isProposedChange(v: unknown): v is WebEngineerProposedChange {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return isString(o.description) && isString(o.rationale) && isString(o.targetPageOrComponent);
}

/**
 * Fail-closed: cualquier campo obligatorio ausente, del tipo equivocado,
 * o approvalRequired !== true lanza -- nunca se "rellena" con un valor
 * por defecto que disfrazaria una salida rota (o una salida que se
 * saltara la aprobacion humana) como si fuera valida.
 */
export function validateWebEngineerOutput(raw: unknown): WebEngineerOutput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Salida web-engineer invalida: se esperaba un objeto JSON.");
  }
  const o = raw as Record<string, unknown>;

  if (!isString(o.implementationSummary)) {
    throw new Error("Salida web-engineer invalida: falta implementationSummary (string).");
  }
  if (!isStringArray(o.targetPages)) {
    throw new Error("Salida web-engineer invalida: targetPages debe ser string[].");
  }
  if (!isStringArray(o.targetComponents)) {
    throw new Error("Salida web-engineer invalida: targetComponents debe ser string[].");
  }
  if (!Array.isArray(o.proposedChanges) || !o.proposedChanges.every(isProposedChange)) {
    throw new Error("Salida web-engineer invalida: proposedChanges debe ser WebEngineerProposedChange[] { description, rationale, targetPageOrComponent }.");
  }
  if (!isStringArray(o.filesOrSystemsAffected)) {
    throw new Error("Salida web-engineer invalida: filesOrSystemsAffected debe ser string[].");
  }
  if (!isStringArray(o.acceptanceCriteria)) {
    throw new Error("Salida web-engineer invalida: acceptanceCriteria debe ser string[].");
  }
  if (!isStringArray(o.validationPlan)) {
    throw new Error("Salida web-engineer invalida: validationPlan debe ser string[].");
  }
  if (!isStringArray(o.rollbackPlan)) {
    throw new Error("Salida web-engineer invalida: rollbackPlan debe ser string[].");
  }
  if (!isStringArray(o.dependencies)) {
    throw new Error("Salida web-engineer invalida: dependencies debe ser string[].");
  }
  if (!isStringArray(o.risks)) {
    throw new Error("Salida web-engineer invalida: risks debe ser string[].");
  }
  if (!isStringArray(o.unknowns)) {
    throw new Error("Salida web-engineer invalida: unknowns debe ser string[].");
  }
  if (typeof o.approvalRequired !== "boolean") {
    throw new Error("Salida web-engineer invalida: approvalRequired debe ser boolean.");
  }
  // Regla estructural de esta fase, no una preferencia de estilo: ver
  // cabecera del fichero y .claude/agents/web-engineer.md ("Que NUNCA
  // debes hacer"). Un web-engineer que devuelva approvalRequired=false
  // es una salida INVALIDA, exactamente igual que un campo ausente.
  if (o.approvalRequired !== true) {
    throw new Error("Salida web-engineer invalida: approvalRequired debe ser SIEMPRE true -- este empleado nunca puede saltarse la aprobacion humana.");
  }

  return o as unknown as WebEngineerOutput;
}

// --- Auditoria de afirmaciones de capacidad tecnica no confirmada ---
//
// Red de seguridad textual de dos pasos: (1) ¿el texto de salida
// contiene una afirmacion CONFIADA de esta categoria (sin lenguaje de
// incertidumbre en la misma clausula)? (2) si es asi, ¿el contexto la
// respalda? Para "plugin_theme"/"api_integration" la respuesta a (2) es
// SIEMPRE "no" en este proyecto (ver NO_PLUGIN_THEME_API_INVENTORY_NOTICE
// en context.ts) -- no hay ningun dato real que pudiera respaldarlas.
// Para "page_exists" el respaldo es confirmedExistingPageUrls.

const HEDGE_TERMS_PATTERN = /pendiente|confirmar|sin confirmar|no se sabe|no sabemos|desconocid|unknown|por determinar|por confirmar|a verificar|verificar si|no confirmado|sin verificar/i;

interface CapabilityClaimCategory {
  id: string;
  label: string;
  assertionPattern: RegExp;
  supported: (context: WebEngineerContext) => boolean;
}

const CAPABILITY_CLAIM_CATEGORIES: CapabilityClaimCategory[] = [
  {
    id: "plugin_theme",
    label: "plugin/tema instalado o disponible",
    assertionPattern: /\bplugin[a-z]*\b[^.\n]{0,60}\b(instalado|disponible|activo|activado|configurado)\b|\b(instalado|disponible|activo|activado)\b[^.\n]{0,60}\bplugin[a-z]*\b|\btema\b[^.\n]{0,60}\b(instalado|disponible|activo)\b/gi,
    // Nunca respaldado: este proyecto no mantiene ningun inventario real de plugins/temas (ver context.ts).
    supported: () => false,
  },
  {
    id: "api_integration",
    label: "API/integracion disponible",
    assertionPattern: /\bAPI\b[^.\n]{0,60}\b(disponible|existe|activa|activo)\b|\bendpoint[a-z]*\b[^.\n]{0,60}\b(disponible|existe)\b|\bintegraci[oó]n\b[^.\n]{0,60}\b(ya\s+)?(disponible|existe)\b/gi,
    // Nunca respaldado: este proyecto no mantiene ningun inventario real de rutas de API (ver context.ts).
    supported: () => false,
  },
  {
    id: "page_exists",
    label: "existencia de pagina en produccion",
    assertionPattern: /\bp[aá]gina\b[^.\n]{0,60}\bya\s+existe\b|\bp[aá]gina\b[^.\n]{0,60}\bya\s+est[aá]\s+publicada\b|\bexiste\s+actualmente\b/gi,
    supported: (context) => context.confirmedExistingPageUrls.length > 0,
  },
];

/** Trocea un texto en clausulas (mismo criterio que landing-architect-comparison.ts splitIntoClauses). */
function splitIntoClauses(text: string): string[] {
  return text
    .split(/[.!?\n;:]+|\s[-—–]\s/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

interface LabeledText {
  field: string;
  text: string;
}

function collectLabeledTextFields(output: WebEngineerOutput): LabeledText[] {
  const fields: LabeledText[] = [{ field: "implementationSummary", text: output.implementationSummary }];
  output.targetPages.forEach((t, i) => fields.push({ field: `targetPages[${i}]`, text: t }));
  output.targetComponents.forEach((t, i) => fields.push({ field: `targetComponents[${i}]`, text: t }));
  output.proposedChanges.forEach((c, i) => {
    fields.push({ field: `proposedChanges[${i}].description`, text: c.description });
    fields.push({ field: `proposedChanges[${i}].rationale`, text: c.rationale });
  });
  output.filesOrSystemsAffected.forEach((t, i) => fields.push({ field: `filesOrSystemsAffected[${i}]`, text: t }));
  output.acceptanceCriteria.forEach((t, i) => fields.push({ field: `acceptanceCriteria[${i}]`, text: t }));
  output.validationPlan.forEach((t, i) => fields.push({ field: `validationPlan[${i}]`, text: t }));
  output.rollbackPlan.forEach((t, i) => fields.push({ field: `rollbackPlan[${i}]`, text: t }));
  output.risks.forEach((t, i) => fields.push({ field: `risks[${i}]`, text: t }));
  // Deliberadamente EXCLUIDOS: `dependencies` y `unknowns` -- son
  // exactamente los campos donde el agente DEBE colocar una necesidad
  // tecnica no confirmada (ver .claude/agents/web-engineer.md). Auditar
  // su texto en busca de "afirmaciones confiadas" generaria falsos
  // positivos sistematicos (p.ej. "confirmar si el plugin X esta
  // instalado antes de continuar" es exactamente el comportamiento
  // deseado, no una fabricacion).
  return fields;
}

/**
 * Para cada categoria de CAPABILITY_CLAIM_CATEGORIES, busca afirmaciones
 * CONFIADAS (sin lenguaje de incertidumbre en la misma clausula) en el
 * texto de salida y las contrasta contra el respaldo real del contexto.
 * Nunca lanza -- devuelve warnings para revision humana. El propio
 * pipeline que llama a esta funcion (scripts/run-web-engineer.ts) NO usa
 * el resultado para bloquear nada automaticamente.
 */
export function auditWebEngineerOutputForUnconfirmedCapabilities(context: WebEngineerContext, output: WebEngineerOutput): string[] {
  const warnings: string[] = [];

  for (const { field, text } of collectLabeledTextFields(output)) {
    for (const clause of splitIntoClauses(text)) {
      if (HEDGE_TERMS_PATTERN.test(clause)) continue; // clausula ya marcada como pendiente/incierta -- cumple la regla, no se audita.

      for (const category of CAPABILITY_CLAIM_CATEGORIES) {
        const matches = clause.match(category.assertionPattern) ?? [];
        if (matches.length === 0) continue;
        if (category.supported(context)) continue;

        warnings.push(`Afirmacion de capacidad tecnica no confirmada (${category.label}) en ${field}: "${clause.slice(0, 120)}${clause.length > 120 ? "..." : ""}" -- el contexto no lo respalda (deberia ir en unknowns/dependencies, no redactado como hecho).`);
      }
    }
  }

  return warnings;
}
