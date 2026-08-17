/**
 * Fase O56 — que hay en `data/`, que clase de dato es cada cosa y que se
 * migra.
 *
 * Este fichero es el resultado del inventario y la razon por la que la
 * migracion NO es "vuelca data/ entero en Mongo". Cada `.jsonl` esta
 * clasificado en una de cuatro clases:
 *
 *   A  estado autoritativo   -> debe sobrevivir siempre. SE MIGRA.
 *   B  evento historico      -> append-only, "que ocurrio". SE MIGRA.
 *   C  estado derivado       -> se puede recalcular ejecutando de nuevo
 *                               al agente que lo produjo. NO se migra:
 *                               meterlo en la fuente de verdad daria a
 *                               entender que su perdida es grave, y no
 *                               lo es. Sigue en fichero.
 *   D  artifact/backup       -> foto puntual de una operacion concreta
 *                               (`o21*.json`, `o22*.json`, dry-runs).
 *                               NO es estado del departamento. NO se
 *                               migra y NO se borra.
 *
 * La distincion A/B decide ademas COMO se escribe: A usa `upsertIfNewer`
 * (la ultima linea gana) y B usa `insertIfAbsent` (inmutable).
 */

export type StateClass = "A" | "B" | "C" | "D";

export interface EntityDescriptor {
  /** Fichero en `data/`, sin ruta. */
  readonly file: string;
  /** Discriminante en la coleccion. Estable: se usa en la clave unica. */
  readonly kind: string;
  readonly stateClass: StateClass;
  /**
   * Campo(s) que forman la identidad estable del registro. Cuando hay
   * mas de uno, la clave es su concatenacion con "#", que es
   * determinista y por tanto idempotente.
   */
  readonly idFields: readonly string[];
  /**
   * Campo de frescura: decide que linea gana cuando hay varias con el
   * mismo id. Solo aplica a la clase A.
   */
  readonly freshnessField: string;
  /** Campo con el instante del registro, para ordenar el historico (clase B). */
  readonly occurredAtField: string;
  /** Campo con el estado vigente, si la entidad tiene uno. */
  readonly statusField?: string;
  /** Por que esta en esta clase. Se lee en la documentacion y en el informe de migracion. */
  readonly rationale: string;
}

/**
 * Registro completo. El orden importa: la migracion procesa los ficheros
 * en este orden, de menor a mayor volumen dentro de cada clase, para que
 * un fallo tardio no deje lo critico sin migrar.
 */
export const ENTITY_REGISTRY: readonly EntityDescriptor[] = [
  // ---------------------------------------------------------------
  // Clase A — estado autoritativo. Se migra. `upsertIfNewer`.
  // ---------------------------------------------------------------
  {
    file: "action-backlog.jsonl",
    kind: "action",
    stateClass: "A",
    idFields: ["actionId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "El backlog es lo que el departamento se debe a si mismo. Perderlo es empezar de cero.",
  },
  {
    file: "work-orders.jsonl",
    kind: "work_order",
    stateClass: "A",
    idFields: ["workOrderId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Trabajo encargado y su estado de avance.",
  },
  {
    file: "change-packs.jsonl",
    kind: "change_pack",
    stateClass: "A",
    idFields: ["changePackId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Contenido propuesto ya elaborado. Regenerarlo cuesta ejecuciones de agente reales.",
  },
  {
    file: "approval-requests.jsonl",
    kind: "approval_request",
    stateClass: "A",
    idFields: ["approvalRequestId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Solicitudes de aprobacion y su respuesta. Contiene decision humana.",
  },
  {
    file: "staging-executions.jsonl",
    kind: "staging_execution",
    stateClass: "A",
    idFields: ["executionId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Que se aplico en staging y con que resultado. Necesario para el rollback.",
  },
  {
    file: "production-executions.jsonl",
    kind: "production_execution",
    stateClass: "A",
    idFields: ["executionId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Que se publico en produccion. Lleva el snapshot del contenido enviado: irreproducible.",
  },
  {
    file: "production-deployment-plans.jsonl",
    kind: "production_deployment_plan",
    stateClass: "A",
    idFields: ["deploymentPlanId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Plan de publicacion aprobado o pendiente.",
  },
  {
    file: "wordpress-drafts.jsonl",
    kind: "wordpress_draft",
    stateClass: "A",
    idFields: ["draftId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Borradores creados en WordPress. Enlazan el estado interno con el sistema externo.",
  },
  {
    file: "asset-requests.jsonl",
    kind: "asset_request",
    stateClass: "A",
    idFields: ["assetRequestId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Peticiones de imagenes en curso hacia n8n.",
  },
  {
    file: "product-asset-requests.jsonl",
    kind: "product_asset_request",
    stateClass: "A",
    idFields: ["assetRequestId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale:
      "Mismo NOMBRE de campo id que asset-requests pero espacio de ids independiente. " +
      "Por eso la clave unica lleva `kind` delante.",
  },
  {
    file: "visual-qa-approvals.jsonl",
    kind: "visual_qa_approval",
    stateClass: "A",
    idFields: ["wordpressPageId", "decidedAt"],
    freshnessField: "decidedAt",
    occurredAtField: "decidedAt",
    rationale: "Es una decision humana sobre una pagina. No se puede recalcular.",
  },
  {
    file: "telegram-reject-prompts.jsonl",
    kind: "telegram_reject_prompt",
    stateClass: "A",
    idFields: ["promptId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Conversacion abierta con el humano esperando un motivo de rechazo.",
  },
  {
    file: "telegram-production-confirmations.jsonl",
    kind: "telegram_production_confirmation",
    stateClass: "A",
    idFields: ["confirmationId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Confirmacion humana de una publicacion en produccion. El fichero puede no existir todavia.",
  },

  // ---------------------------------------------------------------
  // Clase B — historico inmutable. Se migra. `insertIfAbsent`.
  // ---------------------------------------------------------------
  {
    file: "department-events.jsonl",
    kind: "department_event",
    stateClass: "B",
    idFields: ["eventId"],
    freshnessField: "createdAt",
    occurredAtField: "createdAt",
    rationale: "El bus de eventos: como se enteran los agentes de lo que hicieron los demas.",
  },
  {
    file: "jobs.jsonl",
    kind: "seo_job",
    stateClass: "B",
    // OJO: este store rompe la convencion `<entidad>Id` del resto y usa `id` a secas.
    idFields: ["id"],
    freshnessField: "createdAt",
    occurredAtField: "createdAt",
    rationale: "Propuestas del SEO Watcher. Inmutables una vez emitidas.",
  },
  {
    file: "action-audit.jsonl",
    kind: "action_audit",
    stateClass: "B",
    idFields: ["auditId"],
    freshnessField: "changedAt",
    occurredAtField: "changedAt",
    rationale: "Quien cambio el estado de una accion y cuando.",
  },
  {
    file: "work-order-audit.jsonl",
    kind: "work_order_audit",
    stateClass: "B",
    idFields: ["auditId"],
    freshnessField: "changedAt",
    occurredAtField: "changedAt",
    rationale: "Igual que el anterior para work orders.",
  },
  {
    file: "opportunity-state-log.jsonl",
    kind: "opportunity_state_log",
    stateClass: "B",
    // No tiene campo id: su identidad real es "una fila por accion y dia".
    idFields: ["actionId", "date"],
    freshnessField: "recordedAt",
    occurredAtField: "recordedAt",
    rationale:
      "Sin campo id propio. La clave (actionId, date) es su identidad natural y ademas la hace " +
      "idempotente: reejecutar la pasada del mismo dia no crea una segunda fila.",
  },
  {
    file: "production-draft-edits.jsonl",
    kind: "production_draft_edit",
    stateClass: "B",
    idFields: ["editId"],
    // Fase O57 — CORREGIDO. Antes decia `editedAt`, un campo que no existe
    // en ningun registro real: los 4 que hay llevan `createdAt`/`updatedAt`.
    // El resultado era que los 4 documentos se migraban con `occurredAt`
    // vacio. Lo detecto la certificacion independiente, no los tests: los
    // tests usaban datos de mentira que si tenian el campo.
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    rationale: "Ediciones aplicadas sobre contenido ya publicado. Registro para rollback.",
  },
  {
    file: "draft-image-insertions.jsonl",
    kind: "draft_image_insertion",
    stateClass: "B",
    idFields: ["insertionId"],
    // Fase O57 — CORREGIDO por el mismo motivo que `production_draft_edit`:
    // `insertedAt` no existe en los registros reales.
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    rationale: "Imagenes insertadas en borradores. Registro para rollback.",
  },
  {
    file: "visual-review-feedback.jsonl",
    kind: "visual_review_feedback",
    stateClass: "B",
    idFields: ["feedbackId"],
    freshnessField: "createdAt",
    occurredAtField: "createdAt",
    rationale: "Comentario humano literal sobre una revision visual. No se puede reconstruir.",
  },

  // ---------------------------------------------------------------
  // Clase C — derivado. NO se migra en esta fase.
  // ---------------------------------------------------------------
  {
    file: "staging-qa-results.jsonl",
    kind: "staging_qa_result",
    stateClass: "C",
    idFields: ["executionId", "checkedAt"],
    freshnessField: "checkedAt",
    occurredAtField: "checkedAt",
    rationale: "Se regenera volviendo a pasar el QA sobre la ejecucion.",
  },
  {
    file: "landing-blueprints.jsonl",
    kind: "landing_blueprint",
    stateClass: "C",
    idFields: ["blueprintId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    statusField: "status",
    rationale: "Lo regenera el arquitecto de landings a partir del change pack.",
  },
  {
    file: "seo-clusters.jsonl",
    kind: "seo_cluster",
    stateClass: "C",
    idFields: ["clusterId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    rationale: "Lo recalcula el agente de clustering a partir de las keywords.",
  },
  {
    file: "existing-page-audit.jsonl",
    kind: "existing_page_audit",
    stateClass: "C",
    idFields: ["wordpressPageId", "checkedAt"],
    freshnessField: "checkedAt",
    occurredAtField: "checkedAt",
    rationale: "Foto de una pagina externa. Se vuelve a leer cuando hace falta.",
  },
  {
    file: "staging-review-pages.jsonl",
    kind: "staging_review_page",
    // Fase O57 — RECLASIFICADO de C a A. La clasificacion anterior decia
    // "derivable de las ejecuciones de staging" y es FALSA: `publicUrl`
    // es la URL real publicada, y `staging-executions.jsonl` solo guarda
    // `wordpressDraftUrl` (la forma `?page_id=N`). El propio lector
    // (`loadOwnedStagingPages` en scripts/run-department-apply.ts) pone
    // las paginas de revision DESPUES a proposito, para que su URL real
    // gane. Ese dato no existe en ningun otro sitio: si se pierde, el
    // sistema deja de saber que paginas de staging controla y ninguna
    // capacidad de apply se puede confirmar.
    stateClass: "A",
    // La identidad es la pagina, no la publicacion: el lector colapsa por
    // `wordpressPageId` y se queda con la ultima. Meter `publishedAt` en
    // la identidad crearia una entidad nueva por cada republicacion.
    idFields: ["wordpressPageId"],
    freshnessField: "publishedAt",
    occurredAtField: "publishedAt",
    rationale:
      "Catalogo de paginas de staging que el sistema controla. `publicUrl` es la URL real " +
      "publicada y no se puede reconstruir desde ningun otro registro.",
  },
  {
    file: "image-optimizations.jsonl",
    kind: "image_optimization",
    stateClass: "C",
    idFields: ["optimizationId"],
    freshnessField: "updatedAt",
    occurredAtField: "createdAt",
    rationale: "Se puede volver a optimizar la imagen origen.",
  },
  {
    file: "credential-health.jsonl",
    kind: "credential_health",
    stateClass: "C",
    // Sin campo id. Identidad natural: un servicio en un instante.
    idFields: ["service", "recordedAt"],
    freshnessField: "recordedAt",
    occurredAtField: "recordedAt",
    rationale: "La siguiente sonda lo regenera entero. Ademas es lo mas volatil del sistema.",
  },
  {
    file: "telegram-processed-updates.jsonl",
    kind: "telegram_processed_update",
    stateClass: "C",
    idFields: ["updateId"],
    freshnessField: "processedAt",
    occurredAtField: "processedAt",
    rationale:
      "Cursor de idempotencia del webhook de Telegram. Su equivalente autoritativo ya vive en la tabla " +
      "`processed_updates` de D1; duplicarlo aqui crearia dos cursores que pueden divergir.",
  },
];

/** El fichero de decisiones humanas NO esta en el registro: tiene coleccion propia. */
export const HUMAN_DECISIONS_FILE = "department-human-decisions.jsonl";

export function findDescriptorByFile(file: string): EntityDescriptor | null {
  return ENTITY_REGISTRY.find((d) => d.file === file) ?? null;
}

export function findDescriptorByKind(kind: string): EntityDescriptor | null {
  return ENTITY_REGISTRY.find((d) => d.kind === kind) ?? null;
}

/** Los descriptores que la migracion de esta fase toca: clases A y B. */
export function migratableDescriptors(): EntityDescriptor[] {
  return ENTITY_REGISTRY.filter((d) => d.stateClass === "A" || d.stateClass === "B");
}

/**
 * Construye la identidad de un registro concatenando sus `idFields` con
 * "#". Determinista, y por tanto idempotente entre ejecuciones.
 *
 * Devuelve `null` si falta algun campo: un registro sin identidad estable
 * NO se migra a ciegas, se reporta. Inventarle un id seria crear
 * duplicados en la siguiente ejecucion de la migracion.
 */
export function buildEntityId(
  descriptor: EntityDescriptor,
  record: Record<string, unknown>
): string | null {
  const parts: string[] = [];
  for (const field of descriptor.idFields) {
    const value = record[field];
    if (typeof value === "string" && value.trim().length > 0) {
      parts.push(value.trim());
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(String(value));
      continue;
    }
    return null;
  }
  return parts.join("#");
}

/** Lee el campo de frescura de un registro; "" si no lo lleva. */
export function readFreshness(descriptor: EntityDescriptor, record: Record<string, unknown>): string {
  const value = record[descriptor.freshnessField];
  return typeof value === "string" ? value : "";
}

export function readOccurredAt(descriptor: EntityDescriptor, record: Record<string, unknown>): string {
  const value = record[descriptor.occurredAtField];
  return typeof value === "string" ? value : "";
}
