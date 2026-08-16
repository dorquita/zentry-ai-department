import * as fs from "fs";
import * as path from "path";

/**
 * Fase O55 — persistencia del estado del departamento entre pasadas de
 * GitHub Actions.
 *
 * EL PROBLEMA (detectado en docs/vps-retirement-audit.md): los runners de
 * Actions son efimeros. Cada pasada leia `data/*.jsonl` tal y como
 * estaban commiteados, los modificaba en el runner y los perdia al
 * terminar. El estado solo avanzaba porque el VPS legacy lo commiteaba,
 * asi que el departamento "autonomo" seguia dependiendo de el para
 * acumular: el backlog no avanzaba, las transiciones se recalculaban
 * desde cero y una aprobacion de una pasada no existia en la siguiente.
 *
 * LA PROPIEDAD QUE LO HACE SEGURO: todos los `data/*.jsonl` son
 * ESTRICTAMENTE append-only. Se ha verificado sobre los 8 modulos que
 * escriben estado (action-backlog, change-packs, work-orders,
 * approval-requests, opportunity-state-log, job-registry,
 * department-events, credential-health): 8 usan `appendFileSync` y
 * NINGUNO usa `writeFileSync`. El estado actual de una entidad es su
 * linea mas reciente; ninguna linea se reescribe ni se borra jamas.
 *
 * De ahi se siguen dos cosas:
 *
 *   1. Que un fichero de estado ENCOJA (menos lineas que antes) es
 *      imposible en una pasada sana. Si pasa, es corrupcion o perdida de
 *      datos, y este modulo lo convierte en un fallo explicito ANTES de
 *      commitear -- que es justo lo contrario de descubrirlo semanas
 *      despues.
 *   2. Divergir dos ramas es recuperable: la union de lineas es un merge
 *      valido. Aun asi el diseno mantiene UN UNICO ESCRITOR (la rama de
 *      estado la escribe solo el job de persistencia de la pasada
 *      diaria, serializado por el `concurrency` del workflow), porque
 *      "recuperable" no es lo mismo que "correcto".
 *
 * Este modulo es logica PURA salvo el recorrido de directorios: no habla
 * con git, no commitea y no conoce ninguna rama. De eso se encarga el
 * workflow; aqui solo se mide y se compara.
 */

/**
 * Rutas cuyo contenido sobrevive de una pasada a la siguiente.
 *
 * `data` es OBLIGATORIO: es el estado real (backlog, change packs,
 * aprobaciones, eventos, jobs, transiciones).
 *
 * `reports` se incluye porque es el historico de entregables (informes
 * diarios, informes por agente) y es lo que el VPS venia commiteando.
 * No es necesario para la CORRECCION de la siguiente pasada -- los
 * informes se regeneran -- pero perderlo seria perder el historico.
 */
export const STATE_PATHS = ["data", "reports"] as const;

export interface StateFileStat {
  /** Ruta relativa a la raiz del repositorio, siempre con "/" como separador. */
  path: string;
  /** Numero de lineas no vacias. Solo se mide en ficheros .jsonl. `null` en el resto. */
  lines: number | null;
  bytes: number;
}

export interface StateManifest {
  capturedAt: string;
  files: StateFileStat[];
}

/** Una perdida de datos detectada al comparar dos manifiestos. */
export interface StateRegression {
  path: string;
  kind: "file_disappeared" | "lines_lost" | "bytes_lost";
  detail: string;
}

function walk(root: string, baseDir: string, out: string[]): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
      continue;
    }
    if (entry.isFile()) {
      out.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
}

function countNonEmptyLines(absolutePath: string): number {
  const raw = fs.readFileSync(absolutePath, "utf-8");
  let count = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length > 0) count += 1;
  }
  return count;
}

/**
 * Recorre `STATE_PATHS` bajo `baseDir` y mide cada fichero. `capturedAt`
 * se inyecta para que la funcion sea determinista en tests.
 */
export function captureStateManifest(baseDir: string, capturedAt: string): StateManifest {
  const files: StateFileStat[] = [];
  for (const statePath of STATE_PATHS) {
    const relPaths: string[] = [];
    walk(path.join(baseDir, statePath), baseDir, relPaths);
    for (const rel of relPaths.sort()) {
      const absolute = path.join(baseDir, rel);
      const stat = fs.statSync(absolute);
      files.push({
        path: rel,
        lines: rel.endsWith(".jsonl") ? countNonEmptyLines(absolute) : null,
        bytes: stat.size,
      });
    }
  }
  return { capturedAt, files };
}

/**
 * Compara dos manifiestos y devuelve SOLO las regresiones: ficheros que
 * han desaparecido, `.jsonl` con menos lineas que antes, y ficheros que
 * han perdido bytes.
 *
 * Un fichero NUEVO no es una regresion (una pasada crea informes y
 * anade lineas). Crecer tampoco. Lo unico que se prohibe es perder.
 *
 * El chequeo de bytes cubre los ficheros que no son `.jsonl` (informes
 * `.md`, backups `.json`): ahi si puede haber reescritura legitima
 * -- p.ej. el informe del dia se regenera -- pero solo se acepta si el
 * resultado no es MAS PEQUEÑO, que es la firma tipica de un truncado.
 */
export function detectStateRegressions(before: StateManifest, after: StateManifest): StateRegression[] {
  const afterByPath = new Map(after.files.map((f) => [f.path, f]));
  const regressions: StateRegression[] = [];

  for (const previous of before.files) {
    const current = afterByPath.get(previous.path);
    if (!current) {
      regressions.push({
        path: previous.path,
        kind: "file_disappeared",
        detail: `existia antes de la pasada (${previous.bytes} bytes) y ya no esta.`,
      });
      continue;
    }
    if (previous.lines !== null && current.lines !== null && current.lines < previous.lines) {
      regressions.push({
        path: previous.path,
        kind: "lines_lost",
        detail: `${previous.lines} lineas antes, ${current.lines} despues. Los .jsonl de estado son append-only: perder lineas es imposible en una pasada sana.`,
      });
      continue;
    }
    if (current.bytes < previous.bytes) {
      regressions.push({
        path: previous.path,
        kind: "bytes_lost",
        detail: `${previous.bytes} bytes antes, ${current.bytes} despues.`,
      });
    }
  }

  return regressions;
}

export interface StateGrowth {
  newFiles: number;
  filesWithNewLines: number;
  newLines: number;
}

/** Resumen de lo que la pasada ANADIO -- para poder demostrar que el estado avanza. */
export function summarizeStateGrowth(before: StateManifest, after: StateManifest): StateGrowth {
  const beforeByPath = new Map(before.files.map((f) => [f.path, f]));
  let newFiles = 0;
  let filesWithNewLines = 0;
  let newLines = 0;

  for (const current of after.files) {
    const previous = beforeByPath.get(current.path);
    if (!previous) {
      newFiles += 1;
      if (current.lines !== null) newLines += current.lines;
      continue;
    }
    if (previous.lines !== null && current.lines !== null && current.lines > previous.lines) {
      filesWithNewLines += 1;
      newLines += current.lines - previous.lines;
    }
  }

  return { newFiles, filesWithNewLines, newLines };
}

/** Informe legible del resultado de la verificacion. */
export function renderStateVerification(
  before: StateManifest,
  after: StateManifest,
  regressions: StateRegression[]
): string {
  const growth = summarizeStateGrowth(before, after);
  const lines: string[] = [];
  lines.push("## Verificacion del estado del departamento");
  lines.push("");
  lines.push(`- **Manifiesto previo:** ${before.capturedAt} (${before.files.length} fichero(s))`);
  lines.push(`- **Manifiesto posterior:** ${after.capturedAt} (${after.files.length} fichero(s))`);
  lines.push(`- **Ficheros nuevos:** ${growth.newFiles}`);
  lines.push(`- **Ficheros con lineas nuevas:** ${growth.filesWithNewLines}`);
  lines.push(`- **Lineas de estado nuevas:** ${growth.newLines}`);
  lines.push("");
  if (regressions.length === 0) {
    lines.push("**Sin regresiones.** Ningun fichero ha desaparecido, ningun `.jsonl` ha perdido lineas y ninguno ha encogido.");
  } else {
    lines.push(`**${regressions.length} REGRESION(ES) — no se persiste nada:**`);
    lines.push("");
    for (const regression of regressions) {
      lines.push(`- \`${regression.path}\` (${regression.kind}): ${regression.detail}`);
    }
  }
  return lines.join("\n");
}
