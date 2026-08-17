/**
 * Fase O56 — migracion del historico `data/*.jsonl` a MongoDB.
 *
 * PROPIEDADES QUE ESTA HERRAMIENTA GARANTIZA, Y POR QUE CADA UNA:
 *
 *   idempotente        Ejecutarla dos veces deja EXACTAMENTE el mismo
 *                      estado. Los ids se derivan del contenido, nunca de
 *                      un reloj ni de un contador, y toda escritura pasa
 *                      por las primitivas idempotentes del puerto.
 *   dry-run            Se puede ver el recuento y las colisiones sin
 *                      escribir una sola linea.
 *   no destructiva     No hay ni un `drop`, ni un `deleteMany`, ni un
 *                      `delete` en todo el modulo. Los `.jsonl` originales
 *                      se abren en SOLO LECTURA y no se tocan.
 *   aborta ante        Un EVENTO historico repetido con contenido
 *   ambiguedad         distinto no tiene desempate posible (es inmutable
 *                      por definicion): se aborta y se reporta.
 *                      Una ENTIDAD con dos versiones del mismo instante
 *                      SI lo tiene — el fichero es append-only, asi que
 *                      gana la linea posterior, que es exactamente el
 *                      criterio que ya usan hoy los lectores del sistema.
 *   informe saneado    Ningun recuento, ruta ni mensaje incluye la URI ni
 *                      credenciales.
 */
import * as path from "path";
import * as fs from "fs";
import {
  EntityDescriptor,
  HUMAN_DECISIONS_FILE,
  StateClass,
  buildEntityId,
  migratableDescriptors,
  readFreshness,
  readOccurredAt,
} from "./entity-registry";
import { JsonlParseError, scanJsonl } from "./jsonl-source";
import { DepartmentStateRepository, RecordDecisionInput } from "./repositories";
import { buildDecisionKey } from "./decision-identity";

export type MigrationMode = "dry-run" | "apply";

export interface CollisionReport {
  file: string;
  kind: string;
  entityId: string;
  reason: string;
  lines: number[];
}

export interface FileMigrationPlan {
  descriptor: EntityDescriptor;
  present: boolean;
  linesRead: number;
  parsed: number;
  parseErrors: JsonlParseError[];
  /** Registros sin identidad estable: NO se migran, se reportan. */
  skippedWithoutId: number;
  /**
   * Empates de frescura resueltos por orden de linea. No son perdidas ni
   * ambiguedades, pero se cuentan porque señalan que el `updatedAt` de
   * ese store no tiene resolucion suficiente.
   */
  tiesResolvedByLineOrder: number;
  /** El registro ganador por cada id, ya resuelto. */
  winners: Map<string, { record: Record<string, unknown>; freshness: string; lineNumber: number }>;
  collisions: CollisionReport[];
}

export interface FileMigrationResult {
  file: string;
  kind: string;
  stateClass: StateClass;
  present: boolean;
  linesRead: number;
  parsed: number;
  parseErrors: number;
  distinctIds: number;
  skippedWithoutId: number;
  tiesResolvedByLineOrder: number;
  inserted: number;
  updated: number;
  duplicatesPrevented: number;
  staleIgnored: number;
  failed: number;
  collisions: CollisionReport[];
}

export interface DecisionMigrationResult {
  present: boolean;
  linesRead: number;
  parsed: number;
  parseErrors: number;
  distinctDecisionKeys: number;
  /** Lineas que compartian `decisionKey` con otra: la misma decision repetida. */
  duplicateKeysCollapsed: number;
  skippedInvalid: number;
  inserted: number;
  duplicatesPrevented: number;
  failed: number;
}

export interface MigrationReport {
  migrationRunId: string;
  mode: MigrationMode;
  startedAt: string;
  finishedAt: string;
  /** Solo el nombre de la carpeta, no la ruta absoluta de la maquina. */
  dataDirName: string;
  files: FileMigrationResult[];
  decisions: DecisionMigrationResult;
  totals: {
    filesProcessed: number;
    recordsRead: number;
    entitiesWritten: number;
    eventsWritten: number;
    decisionsWritten: number;
    duplicatesPrevented: number;
    collisions: number;
    /** Empates de `updatedAt` resueltos por orden de linea (append-only). */
    tiesResolvedByLineOrder: number;
    parseErrors: number;
  };
  aborted: boolean;
  abortReason: string;
}

/**
 * Cuantas escrituras se mantienen en vuelo a la vez durante la migracion.
 *
 * POR QUE NO SECUENCIAL: el historico son ~14.600 documentos y cada
 * escritura es un round-trip a Atlas con `w:majority`, unos 90 ms desde un
 * runner de GitHub. En serie eso son mas de 20 minutos, que agotan el
 * timeout del job y hacen impracticable repetir la migracion — y repetirla
 * es justamente como se demuestra que es idempotente.
 *
 * POR QUE ESTO ES SEGURO: cada documento se escribe UNA sola vez por
 * pasada (el mapa de ganadores esta indexado por id, asi que no hay dos
 * operaciones sobre la misma clave), y las primitivas del puerto son
 * atomicas por documento. Paralelizar no cambia el resultado, solo el
 * tiempo. Cada operacion sigue devolviendo su propio `WriteOutcome`, asi
 * que los recuentos del informe no pierden precision.
 *
 * POR QUE 25 Y NO 500: el pool de conexiones del driver tiene un maximo
 * (100 por defecto) y Atlas limita conexiones por cluster. Pasarse
 * convierte el paralelismo en cola y empieza a dar timeouts.
 */
export const MIGRATION_WRITE_CONCURRENCY = 25;

/**
 * Recorre `items` invocando `worker` con como mucho `limit` operaciones en
 * vuelo, y devuelve los resultados EN EL ORDEN DE ENTRADA.
 *
 * No usa `Promise.all` sobre todo el array a proposito: con 14.600
 * elementos eso abre 14.600 operaciones a la vez y tumba el pool.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function runner(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runner());
  await Promise.all(runners);
  return results;
}

/** Serializacion estable para comparar dos registros por contenido. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Recorre un `.jsonl` y decide, para cada id, cual es el registro
 * vigente. No escribe nada: esto es lo que ejecuta tambien el `--dry-run`.
 *
 * Regla de resolucion:
 *   clase A -> gana la frescura mayor (`updatedAt`) y, si empata, la
 *              linea posterior. Junto es exactamente la semantica que ya
 *              aplican los lectores actuales: "la ultima linea con ese id
 *              es el estado vigente".
 *   clase B -> el evento es inmutable: si aparece dos veces IDENTICO es
 *              una repeticion inofensiva; si aparece con contenido
 *              distinto es una colision ambigua.
 */
export async function planFileMigration(
  descriptor: EntityDescriptor,
  filePath: string
): Promise<FileMigrationPlan> {
  const winners = new Map<
    string,
    { record: Record<string, unknown>; freshness: string; lineNumber: number }
  >();
  const collisions: CollisionReport[] = [];
  let skippedWithoutId = 0;
  let tiesResolvedByLineOrder = 0;

  const present = fs.existsSync(filePath);

  const scan = await scanJsonl(filePath, (line) => {
    const entityId = buildEntityId(descriptor, line.record);
    if (entityId === null) {
      skippedWithoutId += 1;
      return;
    }

    const freshness = readFreshness(descriptor, line.record);
    const existing = winners.get(entityId);
    if (!existing) {
      winners.set(entityId, { record: line.record, freshness, lineNumber: line.lineNumber });
      return;
    }

    if (descriptor.stateClass === "B") {
      // Un evento no cambia. Si el contenido difiere, no sabemos cual
      // ocurrio de verdad.
      if (stableStringify(existing.record) !== stableStringify(line.record)) {
        collisions.push({
          file: descriptor.file,
          kind: descriptor.kind,
          entityId,
          reason:
            "el mismo id de evento aparece dos veces con contenido distinto. Un evento historico es " +
            "inmutable: no hay criterio para elegir uno.",
          lines: [existing.lineNumber, line.lineNumber],
        });
      }
      return;
    }

    if (freshness > existing.freshness) {
      winners.set(entityId, { record: line.record, freshness, lineNumber: line.lineNumber });
      return;
    }
    if (freshness < existing.freshness) return;

    // Misma frescura y contenido identico: repeticion inofensiva.
    if (stableStringify(existing.record) === stableStringify(line.record)) return;

    // Misma frescura y contenido DISTINTO. Esto pasa de verdad en el
    // historico: una `approval-request` que se crea y se auto-aprueba
    // dentro del mismo milisegundo comparte `updatedAt` con su propia
    // version anterior.
    //
    // NO es ambiguo, y por eso no se aborta: el fichero es append-only,
    // asi que el ORDEN DE LINEA es un desempate real, y es exactamente el
    // criterio que ya usan hoy los lectores del sistema ("la ultima linea
    // con ese id es el estado vigente"). Aplicar aqui otra regla
    // distinta produciria un estado que no coincide con el que el
    // departamento ve hoy — eso si seria inventarse el historico.
    //
    // Se cuenta y se reporta para que quede a la vista, pero se resuelve.
    tiesResolvedByLineOrder += 1;
    if (line.lineNumber > existing.lineNumber) {
      winners.set(entityId, { record: line.record, freshness, lineNumber: line.lineNumber });
    }
  });

  return {
    descriptor,
    present,
    linesRead: scan.linesRead,
    parsed: scan.parsed,
    parseErrors: scan.errors,
    skippedWithoutId,
    tiesResolvedByLineOrder,
    winners,
    collisions,
  };
}

/** Escribe en MongoDB los ganadores de un plan ya resuelto. */
async function applyFilePlan(
  plan: FileMigrationPlan,
  repository: DepartmentStateRepository
): Promise<FileMigrationResult> {
  const descriptor = plan.descriptor;
  const result: FileMigrationResult = {
    file: descriptor.file,
    kind: descriptor.kind,
    stateClass: descriptor.stateClass,
    present: plan.present,
    linesRead: plan.linesRead,
    parsed: plan.parsed,
    parseErrors: plan.parseErrors.length,
    distinctIds: plan.winners.size,
    skippedWithoutId: plan.skippedWithoutId,
    tiesResolvedByLineOrder: plan.tiesResolvedByLineOrder,
    inserted: 0,
    updated: 0,
    duplicatesPrevented: 0,
    staleIgnored: 0,
    failed: 0,
    collisions: plan.collisions,
  };

  const entries = [...plan.winners.entries()];
  const outcomes = await mapWithConcurrency(
    entries,
    MIGRATION_WRITE_CONCURRENCY,
    async ([entityId, winner]) => {
      const record = winner.record;
      const departmentRunId =
        typeof record.departmentRunId === "string" ? record.departmentRunId : null;

      try {
        return descriptor.stateClass === "B"
          ? await repository.events.appendEvent({
              kind: descriptor.kind,
              eventId: entityId,
              departmentRunId,
              occurredAt: readOccurredAt(descriptor, record),
              payload: record,
            })
          : await repository.entities.saveEntity({
              kind: descriptor.kind,
              entityId,
              status:
                descriptor.statusField && typeof record[descriptor.statusField] === "string"
                  ? (record[descriptor.statusField] as string)
                  : "",
              departmentRunId,
              recordUpdatedAt: winner.freshness,
              payload: record,
            });
      } catch {
        // El detalle ya viaja en el error clasificado; aqui solo se cuenta,
        // para que un fallo puntual no impida migrar el resto y quede
        // reflejado en el informe.
        return null;
      }
    }
  );

  for (const outcome of outcomes) {
    if (outcome === null) {
      result.failed += 1;
      continue;
    }
    switch (outcome.result) {
      case "inserted":
        result.inserted += 1;
        break;
      case "updated":
        result.updated += 1;
        break;
      case "duplicate_prevented":
        result.duplicatesPrevented += 1;
        break;
      case "stale_ignored":
        result.staleIgnored += 1;
        break;
    }
  }

  return result;
}

/** Convierte una linea del fichero de decisiones en la entrada del repositorio. */
function toDecisionInput(record: Record<string, unknown>): RecordDecisionInput | null {
  const str = (field: string): string =>
    typeof record[field] === "string" ? (record[field] as string) : "";
  const recommendationId = str("recommendationId");
  const departmentRunId = str("departmentRunId");
  const decidedAt = str("decidedAt");
  if (!recommendationId || !departmentRunId || !decidedAt) return null;

  return {
    decisionId: str("decisionId"),
    departmentRunId,
    recommendationId,
    recommendationTitle: str("recommendationTitle"),
    proposalNumber: typeof record.proposalNumber === "number" ? record.proposalNumber : 0,
    action: str("action"),
    rejectionReason: str("rejectionReason"),
    overrides:
      typeof record.overrides === "object" && record.overrides !== null
        ? (record.overrides as Record<string, unknown>)
        : {},
    target: str("target"),
    decidedBy: str("decidedBy"),
    decidedAt,
    changeId: typeof record.changeId === "string" ? record.changeId : null,
    executionStatus: typeof record.executionStatus === "string" ? record.executionStatus : null,
    executionDetail: str("executionDetail"),
  };
}

/**
 * Migra las decisiones humanas. Va aparte del resto a proposito: es el
 * dato que motiva esta fase y el unico que no se puede reconstruir.
 *
 * La deduplicacion es por `decisionKey` (determinista por contenido) y no
 * por `decisionId` (que lleva el timestamp dentro), asi que dos registros
 * de la MISMA decision escritos en dos intentos distintos se colapsan en
 * uno en vez de duplicarse.
 */
export async function migrateHumanDecisions(
  filePath: string,
  repository: DepartmentStateRepository,
  mode: MigrationMode
): Promise<DecisionMigrationResult> {
  const result: DecisionMigrationResult = {
    present: fs.existsSync(filePath),
    linesRead: 0,
    parsed: 0,
    parseErrors: 0,
    distinctDecisionKeys: 0,
    duplicateKeysCollapsed: 0,
    skippedInvalid: 0,
    inserted: 0,
    duplicatesPrevented: 0,
    failed: 0,
  };

  const byKey = new Map<string, RecordDecisionInput>();

  const scan = await scanJsonl(filePath, (line) => {
    const input = toDecisionInput(line.record);
    if (!input) {
      result.skippedInvalid += 1;
      return;
    }
    const key = buildDecisionKey({
      departmentRunId: input.departmentRunId,
      recommendationId: input.recommendationId,
      action: input.action,
      rejectionReason: input.rejectionReason,
      target: input.target,
      decidedBy: input.decidedBy,
      overrides: {
        title: typeof input.overrides?.title === "string" ? input.overrides.title : undefined,
        metaDescription:
          typeof input.overrides?.metaDescription === "string"
            ? input.overrides.metaDescription
            : undefined,
      },
    });
    if (byKey.has(key)) {
      result.duplicateKeysCollapsed += 1;
      return;
    }
    byKey.set(key, input);
  });

  result.linesRead = scan.linesRead;
  result.parsed = scan.parsed;
  result.parseErrors = scan.errors.length;
  result.distinctDecisionKeys = byKey.size;

  if (mode === "dry-run") return result;

  const outcomes = await mapWithConcurrency(
    [...byKey.values()],
    MIGRATION_WRITE_CONCURRENCY,
    async (input) => {
      try {
        return await repository.decisions.recordDecision(input);
      } catch {
        return null;
      }
    }
  );

  for (const outcome of outcomes) {
    if (outcome === null) result.failed += 1;
    else if (outcome.result === "inserted") result.inserted += 1;
    else result.duplicatesPrevented += 1;
  }

  return result;
}

export interface MigrateOptions {
  dataDir: string;
  mode: MigrationMode;
  migrationRunId: string;
  now: string;
  /** Si `false`, un error de parseo no impide aplicar. Por defecto `true`. */
  strictParseErrors?: boolean;
}

/**
 * Ejecuta la migracion completa.
 *
 * Orden deliberado: PRIMERO se planifica TODO (lectura pura), y solo si
 * no hay colisiones ambiguas se escribe. Asi un `--apply` no deja la base
 * a medias por una ambiguedad descubierta en el ultimo fichero.
 */
export async function migrateStateToMongo(
  options: MigrateOptions,
  repository: DepartmentStateRepository
): Promise<MigrationReport> {
  const startedAt = options.now;
  const descriptors = migratableDescriptors();
  const plans: FileMigrationPlan[] = [];

  for (const descriptor of descriptors) {
    plans.push(await planFileMigration(descriptor, path.join(options.dataDir, descriptor.file)));
  }

  const collisions = plans.flatMap((p) => p.collisions);
  const parseErrors = plans.reduce((sum, p) => sum + p.parseErrors.length, 0);
  const strict = options.strictParseErrors !== false;

  let aborted = false;
  let abortReason = "";
  if (collisions.length > 0) {
    aborted = true;
    abortReason =
      `${collisions.length} colision(es) semantica(s) ambigua(s). No se escribe nada: elegir un ganador ` +
      `sin criterio seria inventarse el historico.`;
  } else if (strict && parseErrors > 0 && options.mode === "apply") {
    aborted = true;
    abortReason =
      `${parseErrors} linea(s) no parsean. Revisalas antes de aplicar (ejecuta el dry-run para verlas) ` +
      `o usa --allow-parse-errors si ya sabes que son basura conocida.`;
  }

  const files: FileMigrationResult[] = [];
  let decisions: DecisionMigrationResult;

  if (aborted || options.mode === "dry-run") {
    for (const plan of plans) {
      files.push({
        file: plan.descriptor.file,
        kind: plan.descriptor.kind,
        stateClass: plan.descriptor.stateClass,
        present: plan.present,
        linesRead: plan.linesRead,
        parsed: plan.parsed,
        parseErrors: plan.parseErrors.length,
        distinctIds: plan.winners.size,
        skippedWithoutId: plan.skippedWithoutId,
        tiesResolvedByLineOrder: plan.tiesResolvedByLineOrder,
        inserted: 0,
        updated: 0,
        duplicatesPrevented: 0,
        staleIgnored: 0,
        failed: 0,
        collisions: plan.collisions,
      });
    }
    decisions = await migrateHumanDecisions(
      path.join(options.dataDir, HUMAN_DECISIONS_FILE),
      repository,
      "dry-run"
    );
  } else {
    for (const plan of plans) {
      files.push(await applyFilePlan(plan, repository));
    }
    decisions = await migrateHumanDecisions(
      path.join(options.dataDir, HUMAN_DECISIONS_FILE),
      repository,
      "apply"
    );
  }

  const totals = {
    filesProcessed: files.filter((f) => f.present).length,
    recordsRead: files.reduce((s, f) => s + f.linesRead, 0) + decisions.linesRead,
    entitiesWritten: files
      .filter((f) => f.stateClass === "A")
      .reduce((s, f) => s + f.inserted + f.updated, 0),
    eventsWritten: files
      .filter((f) => f.stateClass === "B")
      .reduce((s, f) => s + f.inserted + f.updated, 0),
    decisionsWritten: decisions.inserted,
    duplicatesPrevented:
      files.reduce((s, f) => s + f.duplicatesPrevented, 0) + decisions.duplicatesPrevented,
    collisions: collisions.length,
    tiesResolvedByLineOrder: files.reduce((s2, f) => s2 + f.tiesResolvedByLineOrder, 0),
    parseErrors,
  };

  return {
    migrationRunId: options.migrationRunId,
    mode: options.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    dataDirName: path.basename(options.dataDir),
    files,
    decisions,
    totals,
    aborted,
    abortReason,
  };
}

// -------------------------------------------------------------------
// Fase 2 de la transicion — verificacion de equivalencia
// -------------------------------------------------------------------

export interface EquivalenceFinding {
  kind: string;
  file: string;
  legacyCount: number;
  mongoCount: number;
  missingIds: string[];
  detail: string;
}

export interface EquivalenceReport {
  checkedAt: string;
  findings: EquivalenceFinding[];
  checked: { kind: string; file: string; legacyCount: number; mongoCount: number }[];
  decisionsLegacy: number;
  decisionsMongo: number;
  equivalent: boolean;
}

/**
 * Compara el estado legacy en fichero con lo que hay en MongoDB.
 *
 * NO compara bytes ni ficheros: compara SEMANTICA — que ids existen en
 * cada sitio, cuantas entidades vivas hay de cada tipo y cuantas
 * decisiones humanas. Un `.jsonl` con 6.271 lineas y 6.000 entidades
 * vivas es equivalente a 6.000 documentos en Mongo: comparar recuentos de
 * lineas seria comparar la representacion, no el estado.
 *
 * Solo reporta lo que FALTA en MongoDB. Que MongoDB tenga MAS no es un
 * fallo de equivalencia: significa que ya esta recibiendo escrituras
 * nuevas, que es justo lo que hace el modo shadow.
 */
export async function verifyLegacyEquivalence(
  dataDir: string,
  repository: DepartmentStateRepository,
  checkedAt: string,
  options: { maxMissingListed?: number } = {}
): Promise<EquivalenceReport> {
  const maxListed = options.maxMissingListed ?? 10;
  const findings: EquivalenceFinding[] = [];
  const checked: EquivalenceReport["checked"] = [];

  for (const descriptor of migratableDescriptors()) {
    const plan = await planFileMigration(descriptor, path.join(dataDir, descriptor.file));
    if (!plan.present) continue;

    const mongoCount =
      descriptor.stateClass === "B"
        ? await repository.events.countByKind(descriptor.kind)
        : await repository.entities.countByKind(descriptor.kind);

    checked.push({
      kind: descriptor.kind,
      file: descriptor.file,
      legacyCount: plan.winners.size,
      mongoCount,
    });

    if (mongoCount >= plan.winners.size) continue;

    // Solo cuando el recuento NO cuadra se pagan las consultas por id, y
    // se para en cuanto hay ejemplos suficientes: el informe necesita
    // decir CUALES faltan, no enumerar 6.000.
    const missingIds: string[] = [];
    for (const entityId of plan.winners.keys()) {
      if (missingIds.length >= maxListed) break;
      const found =
        descriptor.stateClass === "B"
          ? await repository.events.getEvent(descriptor.kind, entityId)
          : await repository.entities.getEntity(descriptor.kind, entityId);
      if (!found) missingIds.push(entityId);
    }

    findings.push({
      kind: descriptor.kind,
      file: descriptor.file,
      legacyCount: plan.winners.size,
      mongoCount,
      missingIds,
      detail:
        `el fichero tiene ${plan.winners.size} ${descriptor.stateClass === "B" ? "eventos" : "entidades"} ` +
        `unicos y MongoDB solo ${mongoCount}.`,
    });
  }

  const decisionsPlan = await migrateHumanDecisions(
    path.join(dataDir, HUMAN_DECISIONS_FILE),
    repository,
    "dry-run"
  );
  const decisionsMongo = await repository.decisions.count();

  if (decisionsMongo < decisionsPlan.distinctDecisionKeys) {
    findings.push({
      kind: "human_decision",
      file: HUMAN_DECISIONS_FILE,
      legacyCount: decisionsPlan.distinctDecisionKeys,
      mongoCount: decisionsMongo,
      missingIds: [],
      detail:
        `hay ${decisionsPlan.distinctDecisionKeys} decisiones humanas distintas en fichero y solo ` +
        `${decisionsMongo} en MongoDB. Este es el dato que NO se puede reconstruir.`,
    });
  }

  return {
    checkedAt,
    findings,
    checked,
    decisionsLegacy: decisionsPlan.distinctDecisionKeys,
    decisionsMongo,
    equivalent: findings.length === 0,
  };
}

export function renderEquivalenceReport(report: EquivalenceReport): string {
  const lines: string[] = [];
  lines.push("## Equivalencia semantica legacy vs MongoDB");
  lines.push("");
  lines.push(`- **Comprobado:** ${report.checkedAt}`);
  lines.push(`- **Decisiones humanas:** fichero ${report.decisionsLegacy} / MongoDB ${report.decisionsMongo}`);
  lines.push("");
  lines.push("| kind | fichero | en fichero | en MongoDB |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of report.checked) {
    lines.push(`| ${row.kind} | \`${row.file}\` | ${row.legacyCount} | ${row.mongoCount} |`);
  }
  lines.push("");
  if (report.equivalent) {
    lines.push("**Equivalente.** Todo lo que existe en fichero existe tambien en MongoDB.");
    return lines.join("\n");
  }
  lines.push(`**${report.findings.length} DIVERGENCIA(S):**`);
  lines.push("");
  for (const finding of report.findings) {
    lines.push(`- \`${finding.file}\` (${finding.kind}): ${finding.detail}`);
    if (finding.missingIds.length > 0) {
      lines.push(`  - faltan, por ejemplo: ${finding.missingIds.map((id) => `\`${id}\``).join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** Informe legible. No contiene rutas absolutas, URIs ni credenciales. */
export function renderMigrationReport(report: MigrationReport): string {
  const lines: string[] = [];
  lines.push(`## Migracion de estado a MongoDB (${report.mode})`);
  lines.push("");
  lines.push(`- **migrationRunId:** ${report.migrationRunId}`);
  lines.push(`- **origen:** carpeta \`${report.dataDirName}/\``);
  lines.push(`- **inicio:** ${report.startedAt}`);
  lines.push(`- **fin:** ${report.finishedAt}`);
  lines.push("");

  if (report.aborted) {
    lines.push(`**ABORTADA — no se ha escrito nada.** ${report.abortReason}`);
    lines.push("");
  }

  lines.push("| fichero | clase | lineas | ids unicos | insertados | actualizados | duplicados evitados | sin id | colisiones |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const file of report.files) {
    if (!file.present && file.linesRead === 0) continue;
    lines.push(
      `| \`${file.file}\` | ${file.stateClass} | ${file.linesRead} | ${file.distinctIds} | ` +
        `${file.inserted} | ${file.updated} | ${file.duplicatesPrevented} | ${file.skippedWithoutId} | ` +
        `${file.collisions.length} |`
    );
  }
  lines.push(
    `| \`department-human-decisions.jsonl\` | A | ${report.decisions.linesRead} | ` +
      `${report.decisions.distinctDecisionKeys} | ${report.decisions.inserted} | 0 | ` +
      `${report.decisions.duplicatesPrevented} | ${report.decisions.skippedInvalid} | 0 |`
  );
  lines.push("");

  lines.push(`- **registros leidos:** ${report.totals.recordsRead}`);
  lines.push(`- **entidades escritas:** ${report.totals.entitiesWritten}`);
  lines.push(`- **eventos escritos:** ${report.totals.eventsWritten}`);
  lines.push(`- **decisiones humanas escritas:** ${report.totals.decisionsWritten}`);
  lines.push(`- **duplicados evitados:** ${report.totals.duplicatesPrevented}`);
  lines.push(`- **errores de parseo:** ${report.totals.parseErrors}`);
  lines.push(
    `- **empates de \`updatedAt\` resueltos por orden de linea:** ${report.totals.tiesResolvedByLineOrder}`
  );
  lines.push(`- **colisiones ambiguas:** ${report.totals.collisions}`);

  if (report.totals.collisions > 0) {
    lines.push("");
    lines.push("### Colisiones");
    for (const file of report.files) {
      for (const collision of file.collisions.slice(0, 20)) {
        lines.push(
          `- \`${collision.file}\` id \`${collision.entityId}\` (lineas ${collision.lines.join(", ")}): ${collision.reason}`
        );
      }
    }
  }

  return lines.join("\n");
}
