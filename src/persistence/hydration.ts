/**
 * Fase O57 — HIDRATACION: MongoDB proyecta el estado a `data/*.jsonl`.
 *
 * ESTA ES LA PIEZA QUE INVIERTE LA DIRECCION DE AUTORIDAD.
 *
 * Hasta ahora el flujo era:
 *
 *     rama department-state ──► data/*.jsonl ──► lectores ──► decisiones
 *
 * y MongoDB era un espejo al que se escribia al final. Ahora es:
 *
 *     MongoDB ──► data/*.jsonl (proyeccion) ──► lectores ──► decisiones
 *
 * Los ficheros siguen existiendo, pero dejan de ser la fuente: son una
 * PROYECCION que se regenera desde MongoDB al principio de cada pasada.
 * Es exactamente la arquitectura objetivo declarada en `docs/mongodb-state.md`.
 *
 * POR QUE PROYECTAR Y NO CONVERTIR CADA LECTOR A ASYNC:
 *
 * Los lectores de estado (`readCurrentActions`, `readAllEvents`,
 * `readCurrentChangePacks`...) son SINCRONOS y tienen unos 40 llamantes
 * entre los 26 agentes del pipeline v1, los runners de empleado y los
 * scripts de mantenimiento. Convertirlos a async obligaria a propagar
 * `await` por toda esa superficie a la vez, con un riesgo de regresion
 * enorme y ninguna ganancia sobre la propiedad que de verdad importa.
 *
 * La propiedad que importa es: **de donde sale el estado con el que
 * razona el departamento**. Con la hidratacion sale de MongoDB. Que el
 * ultimo tramo sean ficheros locales del runner es un detalle de
 * transporte, no de autoridad — igual que un ORM materializa filas en
 * objetos sin que nadie diga que los objetos son la fuente de verdad.
 *
 * ESTO NO ES UN FALLBACK SILENCIOSO. No hay `try Mongo / catch fichero`.
 * Si el modo es `mongo` y MongoDB no responde, la hidratacion FALLA y la
 * pasada se para: es preferible no correr a correr sobre un `data/` de
 * procedencia desconocida.
 */
import * as fs from "fs";
import * as path from "path";
import {
  ENTITY_REGISTRY,
  EntityDescriptor,
  HUMAN_DECISIONS_FILE,
  migratableDescriptors,
} from "./entity-registry";
import { DepartmentStateRepository } from "./repositories";

export interface HydratedFile {
  file: string;
  kind: string;
  stateClass: string;
  documents: number;
  /** Lineas que tenia el fichero antes de proyectar, si existia. */
  previousLines: number | null;
}

export interface HydrationReport {
  hydratedAt: string;
  dataDirName: string;
  files: HydratedFile[];
  humanDecisions: number;
  /** Ficheros borrados ANTES de proyectar, si se pidio `purgeFirst`. */
  purged: string[];
  totals: {
    filesWritten: number;
    documentsProjected: number;
  };
  /** Ficheros que el registro conoce pero que MongoDB no tiene (clase C/D). */
  notProjected: string[];
}

function countExistingLines(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  let count = 0;
  for (const line of raw.split("\n")) if (line.trim().length > 0) count += 1;
  return count;
}

/**
 * Escribe un `.jsonl` con un registro por linea.
 *
 * Se escribe el `payload` ORIGINAL, tal y como estaba en el historico:
 * los lectores existentes esperan exactamente esa forma y no tienen por
 * que saber que ahora viene de MongoDB. La proyeccion es transparente
 * para ellos, que es justo lo que la hace segura.
 */
function writeJsonl(filePath: string, records: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, records.length > 0 ? `${body}\n` : "", "utf-8");
}

/** Orden estable: dos hidrataciones de los mismos datos dan ficheros identicos. */
function sortRecords(descriptor: EntityDescriptor, records: Record<string, unknown>[]): Record<string, unknown>[] {
  const field = descriptor.stateClass === "B" ? descriptor.occurredAtField : descriptor.freshnessField;
  return [...records].sort((a, b) => {
    const left = typeof a[field] === "string" ? (a[field] as string) : "";
    const right = typeof b[field] === "string" ? (b[field] as string) : "";
    if (left !== right) return left < right ? -1 : 1;
    // Desempate determinista para que el orden no dependa del cursor.
    return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1;
  });
}

/**
 * Proyecta a `dataDir` todo el estado autoritativo que vive en MongoDB.
 *
 * Solo se proyectan las clases A y B — las mismas que se migraron. Los
 * derivados (clase C) y los artifacts (clase D) NO se tocan: si ya
 * existen en el checkout se quedan como estaban, porque MongoDB no es su
 * fuente y sobrescribirlos con vacio seria destruir datos.
 */
export async function hydrateStateFromMongo(
  repository: DepartmentStateRepository,
  dataDir: string,
  hydratedAt: string,
  options: { purgeFirst?: boolean } = {}
): Promise<HydrationReport> {
  const files: HydratedFile[] = [];
  let documentsProjected = 0;

  // `purgeFirst` borra ANTES de proyectar los ficheros que MongoDB posee
  // (clases A y B), y solo esos. Sirve para la prueba de continuidad sin
  // legacy: si despues de borrarlos la pasada funciona, es que el estado
  // autoritativo salio entero de MongoDB y no de ningun fichero que
  // estuviera ahi de antes.
  //
  // Es una operacion sobre el disco EFIMERO del runner, no sobre ningun
  // dato persistido: el historico sigue en la rama de estado y en Atlas.
  // Los ficheros de clase C y D no se tocan -- MongoDB no es su fuente y
  // borrarlos si seria perder datos.
  const purged: string[] = [];
  if (options.purgeFirst) {
    for (const descriptor of migratableDescriptors()) {
      const filePath = path.join(dataDir, descriptor.file);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath);
        purged.push(descriptor.file);
      }
    }
    const decisionsPath = path.join(dataDir, HUMAN_DECISIONS_FILE);
    if (fs.existsSync(decisionsPath)) {
      fs.rmSync(decisionsPath);
      purged.push(HUMAN_DECISIONS_FILE);
    }
  }

  for (const descriptor of migratableDescriptors()) {
    const filePath = path.join(dataDir, descriptor.file);
    const previousLines = countExistingLines(filePath);

    const documents =
      descriptor.stateClass === "B"
        ? await repository.events.listByKind(descriptor.kind)
        : await repository.entities.listByKind(descriptor.kind);

    // El `payload` es el registro original del historico. Si faltara,
    // el documento no sirve para proyectar y se omite en vez de escribir
    // una linea corrupta que rompa al lector.
    const records = documents
      .map((document) => document.payload as Record<string, unknown>)
      .filter((payload): payload is Record<string, unknown> => typeof payload === "object" && payload !== null);

    writeJsonl(filePath, sortRecords(descriptor, records));
    documentsProjected += records.length;
    files.push({
      file: descriptor.file,
      kind: descriptor.kind,
      stateClass: descriptor.stateClass,
      documents: records.length,
      previousLines,
    });
  }

  // Las decisiones humanas van aparte, como en todo lo demas: es el dato
  // que no se puede reconstruir y tiene su propia coleccion.
  const decisionsPath = path.join(dataDir, HUMAN_DECISIONS_FILE);
  const decisionsPrevious = countExistingLines(decisionsPath);
  const decisions = await repository.decisions.listAll();
  const decisionRecords = decisions.map((decision) => ({
    decisionId: decision.decisionId,
    departmentRunId: decision.departmentRunId,
    proposalNumber: decision.proposalNumber,
    recommendationId: decision.recommendationId,
    changeId: decision.changeId,
    recommendationTitle: decision.recommendationTitle,
    action: decision.action,
    rejectionReason: decision.rejectionReason,
    overrides: decision.overrides,
    target: decision.target,
    decidedBy: decision.decidedBy,
    decidedAt: decision.decidedAt,
    executionStatus: decision.executionStatus,
    executionDetail: decision.executionDetail,
  }));
  writeJsonl(decisionsPath, decisionRecords as unknown as Record<string, unknown>[]);
  files.push({
    file: HUMAN_DECISIONS_FILE,
    kind: "human_decision",
    stateClass: "A",
    documents: decisionRecords.length,
    previousLines: decisionsPrevious,
  });
  documentsProjected += decisionRecords.length;

  return {
    hydratedAt,
    dataDirName: path.basename(dataDir),
    files,
    purged,
    humanDecisions: decisionRecords.length,
    totals: { filesWritten: files.length, documentsProjected },
    notProjected: ENTITY_REGISTRY.filter((d) => d.stateClass === "C" || d.stateClass === "D").map(
      (d) => d.file
    ),
  };
}

/** Informe legible. Sin rutas absolutas, sin URIs, sin credenciales. */
export function renderHydrationReport(report: HydrationReport): string {
  const lines: string[] = [];
  lines.push("## Hidratacion del estado desde MongoDB");
  lines.push("");
  lines.push(`- **Momento:** ${report.hydratedAt}`);
  lines.push(`- **Destino:** carpeta \`${report.dataDirName}/\``);
  lines.push(`- **Ficheros proyectados:** ${report.totals.filesWritten}`);
  lines.push(`- **Documentos proyectados:** ${report.totals.documentsProjected}`);
  lines.push(`- **Decisiones humanas:** ${report.humanDecisions}`);
  if (report.purged.length > 0) {
    lines.push(
      `- **Ficheros borrados antes de proyectar:** ${report.purged.length} ` +
        "(prueba de que el estado sale de MongoDB y no de un fichero previo)"
    );
  }
  lines.push("");
  lines.push("| fichero | clase | documentos desde Mongo | lineas que habia antes |");
  lines.push("| --- | --- | --- | --- |");
  for (const file of report.files) {
    if (file.documents === 0 && file.previousLines === null) continue;
    lines.push(
      `| \`${file.file}\` | ${file.stateClass} | ${file.documents} | ${file.previousLines ?? "(no existia)"} |`
    );
  }
  lines.push("");
  lines.push(
    `Los ${report.notProjected.length} fichero(s) de clase C/D no se proyectan: MongoDB no es su fuente ` +
      `y sobrescribirlos seria destruir datos que solo existen en fichero.`
  );
  return lines.join("\n");
}
