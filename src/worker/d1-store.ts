import {
  Approval,
  ApprovalPatch,
  ApprovalStore,
  HumanFeedbackEntry,
  PendingRejectionPrompt,
  ProcessedUpdateResult,
  TransitionInput,
  TransitionOutcome,
} from "../approvals/store";
import { DepartmentChangeStatus, checkTransition, isDepartmentChangeStatus } from "../department/apply/state-machine";
import { D1Database, D1Result } from "./env";

/**
 * IMPLEMENTACION D1 DE `ApprovalStore` -- el unico sitio de todo el
 * sistema que toca la base de datos.
 *
 * Dos decisiones estructurales, ambas a proposito:
 *
 * 1. EL REGISTRO SE GUARDA COMO JSON, NO DESMONTADO EN COLUMNAS.
 *    Un `DepartmentChangeRequest` es un modelo rico (staging, telegram,
 *    humanDecision, production, auditTrail...). Desmontarlo en 30
 *    columnas obligaria a migrar la tabla cada vez que el contrato
 *    crezca, y a reconstruir el objeto a mano en cada lectura -- dos
 *    sitios donde perder un campo en silencio. Se indexa SOLO lo que se
 *    consulta (approval_id, recommendation_id, department_run_id,
 *    status, version) y el resto viaja intacto en el blob.
 *
 * 2. `transition()` ES UN UNICO `UPDATE ... WHERE status IN (...)`.
 *    Nunca un read-then-write. Es LA primitiva de seguridad del sistema:
 *    entre leer el estado y escribirlo cabe un segundo callback de
 *    Telegram, y ahi es donde saldrian dos dispatch de produccion. Al
 *    resolverlo en una sola sentencia condicional, quien pierde la
 *    carrera ve `changes === 0` y devuelve `conflict` sin efectos.
 *
 *    El propio blob JSON se parchea DENTRO de esa misma sentencia con las
 *    funciones JSON de SQLite (`json_patch`, `json_set`), precisamente
 *    para no tener que leerlo antes.
 *
 * Modulo compatible con el runtime de Workers: solo `JSON` y el binding
 * de D1. Sin `fs`, sin `crypto`, sin `Buffer`.
 */

/**
 * Cada sentencia empieza por una etiqueta `-- stmt:<nombre>`. No es
 * decoracion: identifica la sentencia de forma estable en los tests (que
 * usan un doble en memoria de D1) y en `wrangler tail` sin tener que
 * comparar SQL entero.
 */
export const STATEMENT_TAG_PATTERN = /^--\s*stmt:([a-zA-Z]+)/;

/**
 * Schema que este store da por supuesto. Vive aqui, junto al codigo que
 * lo consulta, para que un indice que falte se vea leyendo el store.
 *
 * `infra/cloudflare/schema.sql` (otro scope) es lo que se aplica de
 * verdad con `wrangler d1 execute`: tiene que ser EQUIVALENTE a esto.
 */
export const D1_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS approvals (
     approval_id       TEXT PRIMARY KEY,
     recommendation_id TEXT NOT NULL,
     department_run_id TEXT NOT NULL,
     status            TEXT NOT NULL,
     version           INTEGER NOT NULL,
     created_at        TEXT NOT NULL,
     updated_at        TEXT NOT NULL,
     record            TEXT NOT NULL
   )`,
  // Las versiones de una recomendacion se listan siempre ordenadas: el
  // indice lleva `version` para que el ORDER BY no ordene en memoria.
  `CREATE INDEX IF NOT EXISTS idx_approvals_recommendation ON approvals (recommendation_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_run ON approvals (department_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals (status)`,

  // Idempotencia del webhook: la PK ES el mecanismo. Un INSERT que
  // colisiona no es un error, es la deteccion de un reenvio de Telegram.
  `CREATE TABLE IF NOT EXISTS processed_updates (
     update_id INTEGER PRIMARY KEY,
     at        TEXT NOT NULL
   )`,

  // Una sola pregunta abierta por aprobacion (PK), correlacionable por
  // el mensaje concreto que la hizo o por chat+usuario.
  `CREATE TABLE IF NOT EXISTS rejection_prompts (
     approval_id       TEXT PRIMARY KEY,
     chat_id           TEXT NOT NULL,
     user_id           TEXT NOT NULL,
     prompt_message_id INTEGER,
     created_at        TEXT NOT NULL,
     closed_at         TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_rejection_prompts_open ON rejection_prompts (chat_id, user_id, closed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rejection_prompts_message ON rejection_prompts (chat_id, prompt_message_id)`,
];

// --- Utilidades puras -------------------------------------------------------

/** Filas cambiadas por la sentencia. `changes` es lo canonico; `rows_written` es respaldo. */
export function changedRows(result: D1Result<unknown>): number {
  const meta = result?.meta ?? {};
  const changes = typeof meta.changes === "number" ? meta.changes : undefined;
  if (changes !== undefined) return changes;
  return typeof meta.rows_written === "number" ? meta.rows_written : 0;
}

/**
 * Rellena los campos opcionales que `json_patch` puede haber BORRADO.
 *
 * Detalle real de RFC 7386 (merge patch, que es lo que implementa
 * `json_patch`): un `null` en el parche ELIMINA la clave en vez de
 * ponerla a null. Como el contrato declara esos campos como
 * `X | null` (no opcionales), se normalizan al leer y asi nadie de fuera
 * tiene que distinguir "ausente" de "null".
 */
export function normalizeApproval(raw: unknown): Approval {
  const record = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(record as unknown as Approval),
    staging: (record.staging ?? null) as Approval["staging"],
    telegram: (record.telegram ?? null) as Approval["telegram"],
    humanDecision: (record.humanDecision ?? null) as Approval["humanDecision"],
    production: (record.production ?? null) as Approval["production"],
    inheritedFeedback: Array.isArray(record.inheritedFeedback) ? (record.inheritedFeedback as string[]) : [],
    auditTrail: Array.isArray(record.auditTrail) ? (record.auditTrail as Approval["auditTrail"]) : [],
  };
}

function parseRecord(row: { record?: unknown } | null | undefined): Approval | null {
  if (!row || typeof row.record !== "string") return null;
  try {
    return normalizeApproval(JSON.parse(row.record));
  } catch {
    // Un blob corrupto NO se interpreta a medias: es como si no
    // existiera. Fail-closed -- mejor un `not_found` que una aprobacion
    // reconstruida a la ligera.
    return null;
  }
}

/**
 * Convierte el patch del contrato en un objeto de MERGE PATCH para
 * `json_patch`. `productionRunId` se queda fuera: no es un campo de
 * primer nivel del registro, se escribe aparte (ver `buildRecordExpression`).
 */
export function buildMergePatch(patch: ApprovalPatch | undefined): Record<string, unknown> {
  const merge: Record<string, unknown> = {};
  if (!patch) return merge;
  if (patch.telegram !== undefined) merge.telegram = patch.telegram;
  if (patch.humanDecision !== undefined) merge.humanDecision = patch.humanDecision;
  if (patch.staging !== undefined) merge.staging = patch.staging;
  if (patch.production !== undefined) merge.production = patch.production;
  if (patch.inheritedFeedback !== undefined) merge.inheritedFeedback = patch.inheritedFeedback;
  return merge;
}

export interface RecordExpression {
  sql: string;
  bindings: unknown[];
}

/**
 * Expresion SQL que produce el registro NUEVO a partir del actual, sin
 * haberlo leido antes. Se compone de dentro afuera:
 *
 *   1. `json_patch(record, <merge>)` -- aplica los campos del patch.
 *   2. `json_set(..., '$.status', ..., '$.updatedAt', ..., '$.auditTrail[#]', ...)`
 *      -- estado, marca de tiempo y una entrada de auditoria APPENDEADA
 *      (`[#]` es el indice "una despues del final" de SQLite).
 *   3. Opcional: `json_set(..., '$.production.githubRunId', ...)`.
 *
 * El paso 3 solo se añade si el patch trae `productionRunId`, porque
 * `json_set` con NULL escribiria un null y borraria un run id ya
 * anotado. Y si `$.production` todavia es null, `json_set` no crea el
 * objeto intermedio: la sentencia se queda sin efecto en ese campo en
 * vez de fabricar un `EnvironmentApplyRecord` a medias. Fail-closed.
 */
export function buildRecordExpression(input: {
  patch: ApprovalPatch | undefined;
  status: DepartmentChangeStatus | null;
  at: string;
  audit: { event: string; detail: string };
}): RecordExpression {
  const bindings: unknown[] = [];

  let sql = "json_patch(record, json(?))";
  bindings.push(JSON.stringify(buildMergePatch(input.patch)));

  const auditEntry = JSON.stringify({ at: input.at, event: input.audit.event, detail: input.audit.detail });
  if (input.status !== null) {
    sql = `json_set(${sql}, '$.status', ?, '$.updatedAt', ?, '$.auditTrail[#]', json(?))`;
    bindings.push(input.status, input.at, auditEntry);
  } else {
    sql = `json_set(${sql}, '$.updatedAt', ?, '$.auditTrail[#]', json(?))`;
    bindings.push(input.at, auditEntry);
  }

  if (input.patch && input.patch.productionRunId !== undefined) {
    sql = `json_set(${sql}, '$.production.githubRunId', ?)`;
    bindings.push(input.patch.productionRunId);
  }

  return { sql, bindings };
}

/**
 * Comprueba la transicion contra la MAQUINA DE ESTADOS antes de tocar la
 * base de datos. Una transicion que la maquina no declara no es una
 * carrera perdida: es un BUG del llamador, y se distingue como tal
 * (`illegal_transition`) en vez de disfrazarse de `conflict`.
 *
 * Se exige que TODOS los origenes de `expectedFrom` sean legales. Si uno
 * solo no lo fuera, el `UPDATE` podria ganar por ese y ejecutar una
 * transicion prohibida. Fail-closed: o son legales todos, o no se hace
 * nada.
 */
export function checkExpectedTransitions(expectedFrom: DepartmentChangeStatus[], to: DepartmentChangeStatus): { allowed: boolean; reason: string } {
  if (!isDepartmentChangeStatus(to)) {
    return { allowed: false, reason: `Estado de destino desconocido ("${String(to)}").` };
  }
  const origins = Array.isArray(expectedFrom) ? expectedFrom : [];
  if (origins.length === 0) {
    return { allowed: false, reason: "`expectedFrom` vacio: una transicion incondicional no existe en este sistema." };
  }
  for (const from of origins) {
    const check = checkTransition(from, to);
    if (!check.allowed) return { allowed: false, reason: check.reason };
  }
  return { allowed: true, reason: `Todos los origenes esperados pueden transicionar a "${to}".` };
}

// --- Store ------------------------------------------------------------------

export interface D1ApprovalStoreOptions {
  /** Reloj inyectable: `closeRejectionPrompt` no recibe fecha en el contrato y aun asi debe ser testeable. */
  now?: () => Date;
}

export class D1ApprovalStore implements ApprovalStore {
  private readonly db: D1Database;
  private readonly now: () => Date;

  constructor(db: D1Database, options: D1ApprovalStoreOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
  }

  async get(approvalId: string): Promise<Approval | null> {
    const row = await this.db
      .prepare("-- stmt:get\nSELECT record FROM approvals WHERE approval_id = ?")
      .bind(approvalId)
      .first<{ record?: unknown }>();
    return parseRecord(row);
  }

  async listByRecommendation(recommendationId: string): Promise<Approval[]> {
    const result = await this.db
      .prepare("-- stmt:listByRecommendation\nSELECT record FROM approvals WHERE recommendation_id = ? ORDER BY version ASC, created_at ASC")
      .bind(recommendationId)
      .all<{ record?: unknown }>();
    return (result.results ?? []).map(parseRecord).filter((a): a is Approval => a !== null);
  }

  async listByRun(departmentRunId: string): Promise<Approval[]> {
    const result = await this.db
      .prepare("-- stmt:listByRun\nSELECT record FROM approvals WHERE department_run_id = ? ORDER BY created_at ASC, approval_id ASC")
      .bind(departmentRunId)
      .all<{ record?: unknown }>();
    return (result.results ?? []).map(parseRecord).filter((a): a is Approval => a !== null);
  }

  /**
   * Idempotente por `approvalId` gracias al `ON CONFLICT DO NOTHING`: un
   * reintento del workflow de Actions (que los hay) no puede duplicar ni
   * pisar una aprobacion que ya tiene decision humana.
   */
  async create(approval: Approval): Promise<{ approval: Approval; created: boolean }> {
    const result = await this.db
      .prepare(
        "-- stmt:create\nINSERT INTO approvals (approval_id, recommendation_id, department_run_id, status, version, created_at, updated_at, record)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(approval_id) DO NOTHING"
      )
      .bind(
        approval.changeId,
        approval.recommendationId,
        approval.departmentRunId,
        approval.status,
        approval.version,
        approval.createdAt,
        approval.updatedAt,
        JSON.stringify(approval)
      )
      .run();

    if (changedRows(result) > 0) return { approval: normalizeApproval(approval), created: true };

    // Ya existia: se devuelve LA GUARDADA, nunca la entrante. Lo
    // persistido manda -- puede llevar ya una decision humana encima.
    const existing = await this.get(approval.changeId);
    return { approval: existing ?? normalizeApproval(approval), created: false };
  }

  /**
   * LA operacion critica. Un unico `UPDATE ... WHERE approval_id = ? AND
   * status IN (...)`: o la gana un actor, o no la gana nadie.
   */
  async transition(input: TransitionInput): Promise<TransitionOutcome> {
    const legality = checkExpectedTransitions(input.expectedFrom, input.to);
    if (!legality.allowed) {
      // Ni se toca la base de datos. Se lee el estado actual solo para
      // poder informar de el (una lectura, ninguna escritura).
      const current = await this.get(input.approvalId);
      return { ok: false, reason: "illegal_transition", currentStatus: current?.status ?? null, approval: current };
    }

    const expected = input.expectedFrom;
    const record = buildRecordExpression({ patch: input.patch, status: input.to, at: input.at, audit: input.audit });
    const placeholders = expected.map(() => "?").join(", ");

    const sql =
      "-- stmt:transition\nUPDATE approvals SET status = ?, updated_at = ?, record = " +
      record.sql +
      ` WHERE approval_id = ? AND status IN (${placeholders}) RETURNING record`;

    const bindings: unknown[] = [input.to, input.at, ...record.bindings, input.approvalId, ...expected];
    const result = await this.db.prepare(sql).bind(...bindings).all<{ record?: unknown }>();

    const updated = (result.results ?? [])[0];
    if (changedRows(result) > 0 && updated) {
      const approval = parseRecord(updated);
      if (approval) return { ok: true, approval };
    }

    // No se movio nada. Distinguir "no existe" de "otro llego antes" es
    // lo que permite responder honestamente por Telegram.
    const current = await this.get(input.approvalId);
    if (!current) return { ok: false, reason: "not_found", currentStatus: null, approval: null };
    return { ok: false, reason: "conflict", currentStatus: current.status, approval: current };
  }

  async annotate(
    approvalId: string,
    patch: ApprovalPatch,
    audit: { event: string; detail: string },
    at: string
  ): Promise<Approval | null> {
    const record = buildRecordExpression({ patch, status: null, at, audit });
    const sql = "-- stmt:annotate\nUPDATE approvals SET updated_at = ?, record = " + record.sql + " WHERE approval_id = ? RETURNING record";
    const result = await this.db
      .prepare(sql)
      .bind(at, ...record.bindings, approvalId)
      .all<{ record?: unknown }>();
    const updated = (result.results ?? [])[0];
    return updated ? parseRecord(updated) : null;
  }

  /**
   * IDEMPOTENCIA DEL WEBHOOK. La clave primaria hace todo el trabajo: si
   * el INSERT no cambia ninguna fila es que ese `update_id` ya se
   * proceso, y quien llama tiene que abortar SIN efectos.
   */
  async markUpdateProcessed(updateId: number, at: string): Promise<ProcessedUpdateResult> {
    const result = await this.db
      .prepare("-- stmt:markUpdate\nINSERT INTO processed_updates (update_id, at) VALUES (?, ?) ON CONFLICT(update_id) DO NOTHING")
      .bind(updateId, at)
      .run();
    return { isNew: changedRows(result) > 0 };
  }

  /**
   * Una sola pregunta abierta por aprobacion (la PK lo garantiza). Si se
   * vuelve a preguntar, se reabre con el mensaje NUEVO: el motivo se
   * correlaciona con la ultima pregunta, no con una vieja ya respondida.
   */
  async openRejectionPrompt(prompt: PendingRejectionPrompt): Promise<void> {
    await this.db
      .prepare(
        "-- stmt:openPrompt\nINSERT INTO rejection_prompts (approval_id, chat_id, user_id, prompt_message_id, created_at, closed_at)" +
          " VALUES (?, ?, ?, ?, ?, NULL)" +
          " ON CONFLICT(approval_id) DO UPDATE SET chat_id = excluded.chat_id, user_id = excluded.user_id," +
          " prompt_message_id = excluded.prompt_message_id, created_at = excluded.created_at, closed_at = NULL"
      )
      .bind(prompt.approvalId, prompt.chatId, prompt.userId, prompt.promptMessageId, prompt.createdAt)
      .run();
  }

  async findOpenRejectionPrompt(chatId: string, userId: string): Promise<PendingRejectionPrompt | null> {
    const row = await this.db
      .prepare(
        "-- stmt:findOpenPrompt\nSELECT approval_id, chat_id, user_id, prompt_message_id, created_at FROM rejection_prompts" +
          " WHERE chat_id = ? AND user_id = ? AND closed_at IS NULL ORDER BY created_at DESC, approval_id DESC LIMIT 1"
      )
      .bind(chatId, userId)
      .first<Record<string, unknown>>();
    return rowToPrompt(row);
  }

  /**
   * Correlacion PREFERENTE. Con dos rechazos abiertos a la vez, chat +
   * usuario ya no distingue: el `message_id` del mensaje respondido si.
   */
  async findRejectionPromptByMessageId(chatId: string, promptMessageId: number): Promise<PendingRejectionPrompt | null> {
    const row = await this.db
      .prepare(
        "-- stmt:findPromptByMessage\nSELECT approval_id, chat_id, user_id, prompt_message_id, created_at FROM rejection_prompts" +
          " WHERE chat_id = ? AND prompt_message_id = ? AND closed_at IS NULL LIMIT 1"
      )
      .bind(chatId, promptMessageId)
      .first<Record<string, unknown>>();
    return rowToPrompt(row);
  }

  async closeRejectionPrompt(approvalId: string): Promise<void> {
    await this.db
      .prepare("-- stmt:closePrompt\nUPDATE rejection_prompts SET closed_at = ? WHERE approval_id = ? AND closed_at IS NULL")
      .bind(this.now().toISOString(), approvalId)
      .run();
  }

  /**
   * Feedback humano REAL: solo aprobaciones efectivamente rechazadas y
   * con motivo escrito. Un rechazo sin motivo (todavia en
   * `awaiting_rejection_reason`) no es feedback, es una pregunta abierta,
   * y no se le enseña a nadie como si fuera una decision cerrada.
   */
  async listHumanFeedback(recommendationId: string): Promise<HumanFeedbackEntry[]> {
    const result = await this.db
      .prepare("-- stmt:feedback\nSELECT record FROM approvals WHERE recommendation_id = ? AND status = 'rejected' ORDER BY version ASC")
      .bind(recommendationId)
      .all<{ record?: unknown }>();

    const entries: HumanFeedbackEntry[] = [];
    for (const row of result.results ?? []) {
      const approval = parseRecord(row);
      if (!approval) continue;
      const reason = (approval.humanDecision?.rejectionReason ?? "").trim();
      if (reason.length === 0) continue;
      entries.push({
        approvalId: approval.changeId,
        recommendationId: approval.recommendationId,
        recommendationTitle: approval.title,
        version: approval.version,
        rejectionReason: reason,
        rejectedAt: approval.humanDecision?.decidedAt ?? approval.updatedAt,
      });
    }
    return entries;
  }
}

function rowToPrompt(row: Record<string, unknown> | null | undefined): PendingRejectionPrompt | null {
  if (!row) return null;
  const messageId = row.prompt_message_id;
  return {
    approvalId: String(row.approval_id ?? ""),
    chatId: String(row.chat_id ?? ""),
    userId: String(row.user_id ?? ""),
    promptMessageId: typeof messageId === "number" ? messageId : messageId === null || messageId === undefined ? null : Number(messageId),
    createdAt: String(row.created_at ?? ""),
  };
}
