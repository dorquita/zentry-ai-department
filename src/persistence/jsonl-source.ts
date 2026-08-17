/**
 * Fase O56 — lectura de los `.jsonl` historicos para la migracion.
 *
 * Se lee EN STREAMING linea a linea, no con un `readFileSync` del fichero
 * entero: `data/action-backlog.jsonl` pesa 20 MB y `data/change-packs.jsonl`
 * 16 MB, y cargarlos completos en memoria a la vez ademas de parsearlos
 * duplica el pico sin ninguna necesidad.
 *
 * Este modulo NO escribe ni modifica nada. La migracion es de solo
 * lectura sobre el historico: los `.jsonl` originales se quedan
 * exactamente como estan.
 */
import * as fs from "fs";
import * as readline from "readline";

export interface JsonlLine {
  /** 1-based, para poder señalar la linea exacta en un informe. */
  lineNumber: number;
  record: Record<string, unknown>;
}

export interface JsonlParseError {
  lineNumber: number;
  /** Motivo. Nunca incluye el contenido completo de la linea. */
  reason: string;
}

export interface JsonlScanResult {
  linesRead: number;
  parsed: number;
  errors: JsonlParseError[];
}

/**
 * Recorre un `.jsonl` invocando `onRecord` por cada linea valida.
 *
 * Una linea que no parsea NO aborta el recorrido: se acumula como error y
 * se reporta. Abortar dejaria la migracion a medias por una linea
 * corrupta de hace meses, y la mitad migrada seria peor que ninguna.
 * Lo que si hace la herramienta es negarse a aplicar si hay errores sin
 * revisar (ver `migration.ts`).
 */
export async function scanJsonl(
  filePath: string,
  onRecord: (line: JsonlLine) => void | Promise<void>
): Promise<JsonlScanResult> {
  const result: JsonlScanResult = { linesRead: 0, parsed: 0, errors: [] };
  if (!fs.existsSync(filePath)) return result;

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    let lineNumber = 0;
    for await (const raw of reader) {
      lineNumber += 1;
      if (raw.trim().length === 0) continue;
      result.linesRead += 1;

      let record: unknown;
      try {
        record = JSON.parse(raw);
      } catch (err) {
        result.errors.push({
          lineNumber,
          reason: `JSON invalido: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      if (typeof record !== "object" || record === null || Array.isArray(record)) {
        result.errors.push({ lineNumber, reason: "la linea no es un objeto JSON" });
        continue;
      }

      result.parsed += 1;
      await onRecord({ lineNumber, record: record as Record<string, unknown> });
    }
  } finally {
    reader.close();
    stream.close();
  }

  return result;
}

/** Numero de lineas no vacias de un `.jsonl`, sin parsear nada. */
export async function countJsonlLines(filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) return 0;
  let count = 0;
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of reader) {
      if (raw.trim().length > 0) count += 1;
    }
  } finally {
    reader.close();
    stream.close();
  }
  return count;
}
