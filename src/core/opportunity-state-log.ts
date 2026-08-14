import * as fs from "fs";
import * as path from "path";
import { OpportunityState } from "./opportunity-state";
import { resolveActiveClientPaths } from "./client-paths";

/**
 * Fase O49 — bitacora diaria persistida del estado de cada oportunidad.
 *
 * Causa raiz encontrada en produccion (2026-08-11/12/13): la seccion
 * "Tareas avanzadas hoy" del informe ejecutivo (ver
 * growth-director.ts/executive-report.ts, Fase O27) calculaba el "estado
 * de ayer" reconstruyendolo con `buildOpportunityStateContextAsOf()`
 * (filtrando change packs/ejecuciones por su `updatedAt` respecto a la
 * medianoche de hoy). Ese metodo asume que si nada cambio de verdad, los
 * registros de ayer siguen "vigentes" hoy — pero los Change Pack Builders
 * (SEO/Content/CRO) regeneran un change pack NUEVO cada dia para
 * cualquier oportunidad que siga abierta (mismo criterio de negocio,
 * `createdAt` de hoy), aunque nada de fondo haya cambiado. Resultado real
 * verificado: `buildOpportunityStateContextAsOf` excluia el change pack
 * de hoy, veia solo restos antiguos de la oportunidad (o ninguno) y
 * calculaba un "estado de ayer" artificialmente bajo (`detected`) —
 * asi que la misma pagina, bloqueada en `qa_passed` desde el 10 de
 * agosto, aparecia como "Detectada -> QA superado (en staging)" en la
 * seccion "Tareas avanzadas hoy" de los dias 11, 12 y 13 por igual.
 *
 * La solucion no es afinar el calculo por fecha (fragil mientras exista
 * churn de change packs) sino dejar de reconstruir "el estado de ayer":
 * se persiste el estado YA CALCULADO cada dia (append-only, mismo patron
 * que el resto del proyecto) y el dia siguiente se compara contra ESE
 * dato, nunca contra una reconstruccion por timestamp.
 *
 * Efecto secundario deseado: como cada entrada lleva `daysInState`, el
 * resto del informe (Fase O49) puede escalar cualquier oportunidad
 * bloqueada 2+ dias en el MISMO estado sin depender de contar
 * manualmente "cuantos dias lleva" cada vez.
 */

export interface OpportunityStateLogEntry {
  actionId: string;
  date: string; // YYYY-MM-DD
  state: OpportunityState;
  daysInState: number;
  recordedAt: string;
}

function resolveFilePath(): string {
  const dataDir = resolveActiveClientPaths().dataDir;
  return path.join(dataDir, "opportunity-state-log.jsonl");
}

function readAll(): OpportunityStateLogEntry[] {
  const filePath = resolveFilePath();
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OpportunityStateLogEntry);
}

function append(entry: OpportunityStateLogEntry): void {
  const filePath = resolveFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

/** Ultima entrada de un actionId con `date` ANTERIOR a `todayDate`. */
function findLastEntryBefore(actionId: string, todayDate: string, allEntries: OpportunityStateLogEntry[]): OpportunityStateLogEntry | undefined {
  let best: OpportunityStateLogEntry | undefined;
  for (const entry of allEntries) {
    if (entry.actionId !== actionId || entry.date >= todayDate) continue;
    if (!best || entry.date > best.date) best = entry;
  }
  return best;
}

/** Ultima entrada de un actionId con `date` IGUAL a `todayDate` (para no duplicar si esta funcion se llama dos veces el mismo dia). */
function findTodayEntry(actionId: string, todayDate: string, allEntries: OpportunityStateLogEntry[]): OpportunityStateLogEntry | undefined {
  let best: OpportunityStateLogEntry | undefined;
  for (const entry of allEntries) {
    if (entry.actionId !== actionId || entry.date !== todayDate) continue;
    if (!best || entry.recordedAt > best.recordedAt) best = entry;
  }
  return best;
}

export interface OpportunityStateDiff {
  previousState: OpportunityState | null;
  currentState: OpportunityState;
  daysInState: number;
  changedToday: boolean;
}

/**
 * Registra el estado de HOY para cada oportunidad y devuelve, para cada
 * una, el diff contra el ultimo estado persistido (nunca reconstruido por
 * fecha). Idempotente dentro del mismo dia: si ya hay una entrada de hoy
 * para un actionId, se reutiliza en vez de crear una nueva racha.
 */
export function recordAndDiffOpportunityStates(
  states: Array<{ actionId: string; currentState: OpportunityState }>,
  todayDate: string
): Map<string, OpportunityStateDiff> {
  const allEntries = readAll();
  const result = new Map<string, OpportunityStateDiff>();

  for (const { actionId, currentState } of states) {
    const existingToday = findTodayEntry(actionId, todayDate, allEntries);
    if (existingToday) {
      const previousEntry = findLastEntryBefore(actionId, todayDate, allEntries);
      result.set(actionId, {
        previousState: previousEntry?.state ?? null,
        currentState: existingToday.state,
        daysInState: existingToday.daysInState,
        changedToday: previousEntry ? previousEntry.state !== existingToday.state : true,
      });
      continue;
    }

    const previousEntry = findLastEntryBefore(actionId, todayDate, allEntries);
    const daysInState = previousEntry && previousEntry.state === currentState ? previousEntry.daysInState + 1 : 0;
    const entry: OpportunityStateLogEntry = {
      actionId,
      date: todayDate,
      state: currentState,
      daysInState,
      recordedAt: new Date().toISOString(),
    };
    append(entry);
    allEntries.push(entry); // para que las siguientes iteraciones de este mismo bucle ya lo vean si hiciera falta

    result.set(actionId, {
      previousState: previousEntry?.state ?? null,
      currentState,
      daysInState,
      changedToday: previousEntry ? previousEntry.state !== currentState : true,
    });
  }

  return result;
}
