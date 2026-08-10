import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { DepartmentEvent, DepartmentEventType, EventPriority } from "./types";
import { resolveActiveClientPaths } from "./client-paths";

const DATA_DIR = resolveActiveClientPaths().dataDir;
const EVENTS_FILE = path.join(DATA_DIR, "department-events.jsonl");

export interface EmitEventInput {
  departmentRunId: string;
  agent: string;
  department?: string;
  type: DepartmentEventType;
  priority?: EventPriority;
  summary: string;
  payload?: Record<string, unknown>;
}

/**
 * Cada agente del departamento escribe aqui su actividad interna. Append-
 * only: nunca borra ni reescribe una linea existente en
 * data/department-events.jsonl. Es el "bus de eventos" que permite a un
 * agente (p.ej. Growth Director) leer que hicieron los demas en la misma
 * pasada (mismo departmentRunId).
 */
export function emitEvent(input: EmitEventInput): DepartmentEvent {
  const event: DepartmentEvent = {
    eventId: randomUUID(),
    departmentRunId: input.departmentRunId,
    agent: input.agent,
    department: input.department ?? "web-growth",
    type: input.type,
    priority: input.priority ?? "low",
    summary: input.summary,
    payload: input.payload ?? {},
    createdAt: new Date().toISOString(),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n", "utf-8");
  return event;
}

/** Lee TODO el historico de eventos (solo lectura). */
export function readAllEvents(): DepartmentEvent[] {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const raw = fs.readFileSync(EVENTS_FILE, "utf-8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DepartmentEvent);
}

/** Lee solo los eventos de un departmentRunId concreto. */
export function readEventsForRun(departmentRunId: string): DepartmentEvent[] {
  return readAllEvents().filter((e) => e.departmentRunId === departmentRunId);
}

export function getEventsFilePath(): string {
  return EVENTS_FILE;
}
