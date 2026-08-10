/**
 * Un departmentRunId por pasada diaria del departamento, p.ej.
 * "growth-department-2026-08-02T100000Z". Todos los agentes ejecutados en
 * la misma pasada (scripts/run-daily-growth-department.ts) comparten este
 * id y lo usan para etiquetar sus eventos en data/department-events.jsonl.
 *
 * Cuando un agente se ejecuta de forma independiente (su propio npm run
 * seo:watch, seo:director, etc., fuera de la pasada diaria), genera su
 * propio departmentRunId de un solo agente — sigue siendo valido como
 * agrupador de eventos, solo que con un unico agente dentro.
 */
export function buildDepartmentRunId(now: Date = new Date()): string {
  const iso = now.toISOString();
  const datePart = iso.slice(0, 10);
  const timePart = iso.slice(11, 19).replace(/:/g, "");
  return `growth-department-${datePart}T${timePart}Z`;
}
