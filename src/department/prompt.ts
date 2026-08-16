import * as fs from "fs";
import * as path from "path";
import { PreviousHumanFeedback, renderPreviousHumanFeedback } from "../approvals/human-feedback-context";

/**
 * Ensamblado del prompt de una etapa coordinada. Mismo patron EXACTO
 * que los runners individuales de cada empleado
 * (scripts/run-<empleado>.ts, `buildPromptMarkdown`): instrucciones del
 * subagente tal cual (quitando el frontmatter YAML) + contexto
 * estructurado en JSON + recordatorio de contrato de salida. No cambia
 * el runtime comun ni relaja nada -- solo construye el texto que el
 * runtime comun ya sabe pasar a `claude-code-action`.
 */

const PROJECT_ROOT = path.join(__dirname, "..", "..");

export function readAgentInstructions(agentName: string): string {
  const agentPath = path.join(PROJECT_ROOT, ".claude", "agents", `${agentName}.md`);
  const raw = fs.readFileSync(agentPath, "utf-8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export interface DepartmentPromptInput {
  agentName: string;
  departmentRunId: string;
  contextTitle: string;
  context: unknown;
  /** Reglas de coordinacion especificas de ESTA fase -- se listan literalmente antes del contexto. */
  coordinationRules: string[];
  /**
   * Rechazos humanos anteriores sobre estas mismas recomendaciones. Van
   * ANTES del contexto y con el motivo LITERAL, nunca reescrito (ver
   * src/approvals/human-feedback-context.ts). Vacio u omitido = no se
   * imprime ninguna seccion: un bloque que diga "no hay feedback" solo
   * gasta contexto.
   */
  previousHumanFeedback?: PreviousHumanFeedback[];
}

export function buildDepartmentPrompt(input: DepartmentPromptInput): string {
  const lines: string[] = [];
  lines.push(`# Prompt preparado para ${input.agentName} -- pasada coordinada del departamento ${input.departmentRunId}`);
  lines.push("");
  lines.push(
    "Este fichero es la union de: (1) instrucciones del subagente, (2) reglas de la pasada COORDINADA del departamento, (3) contexto estructurado ya resuelto. El subagente no tiene herramientas -- todo lo que necesita esta aqui."
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Instrucciones del subagente");
  lines.push("");
  lines.push(readAgentInstructions(input.agentName));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Reglas de esta pasada coordinada del departamento");
  lines.push("");
  lines.push(
    `Esta ejecucion forma parte de UNA pasada coordinada del departamento (departmentRunId de coordinacion: \`${input.departmentRunId}\`). Las siguientes reglas son OBLIGATORIAS y tienen prioridad sobre cualquier suposicion propia:`
  );
  lines.push("");
  for (const rule of input.coordinationRules) {
    lines.push(`- ${rule}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Va DELANTE del contexto a proposito: es una decision humana ya
  // tomada sobre estas mismas propuestas, y quien lea el prompt tiene
  // que verla antes de volver a proponer lo mismo.
  const feedbackBlock = renderPreviousHumanFeedback(input.previousHumanFeedback ?? []);
  if (feedbackBlock) {
    lines.push(feedbackBlock.replace(/^## /, "## 3. ").trimEnd());
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(`## 4. ${input.contextTitle}`);
  } else {
    lines.push(`## 3. ${input.contextTitle}`);
  }
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(input.context, null, 2));
  lines.push("```");
  lines.push("");
  lines.push('Devuelve UNICAMENTE el JSON de salida descrito en las instrucciones del subagente (seccion "Que debes producir"), sin texto adicional.');
  lines.push("");
  return lines.join("\n");
}
