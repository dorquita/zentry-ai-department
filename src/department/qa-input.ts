import { GrowthDirectorV2Output } from "../employees/growth-director-v2/types";
import { DEPARTMENT_RUN_CONTRACT_VERSION, DepartmentRunManifest, DepartmentStageStatus } from "./types";
import { DepartmentSpecialistInput, LoadedSpecialistInputs } from "./specialist-inputs";

/**
 * FASE 3 -- lo que revisa `qa-reviewer` en una pasada coordinada.
 *
 * Decision de diseno: qa-reviewer NO se modifica ni se reimplementa. Su
 * runner (scripts/run-qa-reviewer.ts) ya acepta cualquier artifact JSON
 * via `--artifact-path` y ata la identidad de lo revisado
 * (`reviewedArtifact`) al fichero que se le entrego. Esta capa solo
 * construye ESE fichero: un bundle autocontenido con las salidas reales
 * de los especialistas Y la sintesis de Growth de esta misma pasada,
 * para que la revision sea sobre el conjunto y no sobre un artifact
 * suelto.
 *
 * `reviewInstructionsForQa` es texto FIJO (nunca derivado de datos):
 * enfoca la revision al contrato de esta fase sin tocar las
 * instrucciones del agente ni relajar ninguno de sus criterios.
 */

export interface QaBundleStageSummary {
  employee: string;
  status: DepartmentStageStatus;
  note: string;
  sourceRunId: string | null;
}

export interface DepartmentQaInputBundle {
  contractVersion: string;
  departmentRunId: string;
  generatedAt: string;
  reviewInstructionsForQa: string[];
  stages: QaBundleStageSummary[];
  specialistOutputs: { employee: string; status: DepartmentStageStatus; output?: unknown }[];
  growth: { status: DepartmentStageStatus; note: string; output?: GrowthDirectorV2Output; auditWarnings: string[] };
  /**
   * SEM se sigue exponiendo como bloque propio (compatibilidad del
   * contrato con revisiones anteriores), pero su `status` ya NO esta
   * cableado a "not_available": es el estado REAL de la etapa en esta
   * pasada, igual que el de cualquier otro especialista.
   */
  semStatus: { employee: "sem-specialist"; status: DepartmentStageStatus; note: string };
}

export const QA_REVIEW_INSTRUCTIONS: string[] = [
  "Este artifact es el resultado COMPLETO de una pasada coordinada del departamento: las salidas reales de los especialistas (SEO / Content / Analytics / SEM) y la sintesis del Growth Director sobre ellas.",
  "Revisa las dos capas: (a) los outputs de los especialistas y (b) la sintesis/priorizacion de growth-director-v2 sobre ellos.",
  "Busca especificamente: afirmaciones sin evidencia que las respalde dentro de este mismo artifact, contradicciones entre especialistas o entre un especialista y Growth, recomendaciones debiles o no accionables, riesgos, problemas de seguridad, y cualquier elemento que exija aprobacion humana antes de tocar nada.",
  "Un especialista con status distinto de `executed` NO aporto datos en esta pasada: si Growth afirma algo que solo podria salir de ese especialista ausente, eso es un hallazgo (fabricacion o claim sin respaldo), no una omision menor.",
  "sem-specialist (Google Ads) participa en la pasada como un especialista mas: si su status es `executed`, revisa su salida con el mismo rigor que las demas. Si NO lo es, su ausencia por si sola no es un defecto de calidad -- pero cualquier afirmacion del artifact que ASUMA datos de Google Ads sin que SEM los haya aportado SI es un hallazgo.",
  "Se concreto: cuando marques una recomendacion como problematica, cita su titulo EXACTO tal como aparece en `growth.output.recommendedPriorities[].title`. El departamento usa esa coincidencia literal de titulo para decidir, de forma deterministica, que recomendaciones NO se promueven a la fase de ingenieria.",
  "Un hallazgo `critical` o cualquier entrada en `safetyConcerns` BLOQUEA la promocion de la recomendacion citada. No uses `critical` para matices de estilo, ni `info` para un riesgo real.",
  "Ninguna parte de este artifact se ha aplicado a ningun sistema: es una propuesta de solo lectura. No evalues como si ya estuviera publicado.",
];

export function buildDepartmentQaInputBundle(
  manifest: DepartmentRunManifest,
  specialists: LoadedSpecialistInputs,
  growth: { status: DepartmentStageStatus; reason: string; output?: GrowthDirectorV2Output; auditWarnings?: string[] },
  now: Date = new Date()
): DepartmentQaInputBundle {
  const semInput = specialists.inputs.find((i) => i.employee === "sem-specialist") as DepartmentSpecialistInput | undefined;

  return {
    contractVersion: DEPARTMENT_RUN_CONTRACT_VERSION,
    departmentRunId: manifest.departmentRunId,
    generatedAt: now.toISOString(),
    reviewInstructionsForQa: QA_REVIEW_INSTRUCTIONS,
    stages: specialists.inputs.map((i) => ({ employee: i.employee, status: i.status, note: i.note, sourceRunId: i.sourceRunId })),
    specialistOutputs: specialists.inputs.map((i) =>
      i.status === "executed" ? { employee: i.employee, status: i.status, output: i.output } : { employee: i.employee, status: i.status }
    ),
    growth: {
      status: growth.status,
      note:
        growth.status === "executed"
          ? "Sintesis real de growth-director-v2 sobre los outputs de esta misma pasada."
          : `growth-director-v2 no produjo sintesis utilizable en esta pasada (status=${growth.status}): ${growth.reason}. No hay priorizacion cross-channel que revisar.`,
      output: growth.status === "executed" ? growth.output : undefined,
      auditWarnings: growth.auditWarnings ?? [],
    },
    semStatus: {
      employee: "sem-specialist",
      status: semInput?.status ?? "not_available",
      note: semInput?.note ?? "sem-specialist no llego a registrarse en el manifiesto de esta pasada -- no hay ningun dato de Google Ads que revisar.",
    },
  };
}
