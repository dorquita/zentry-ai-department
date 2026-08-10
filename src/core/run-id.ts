/**
 * Un runId por ejecucion del agente, p.ej. "seo-watcher-2026-08-02T113800Z".
 * Se usa para agrupar todos los jobs y el informe markdown de una misma
 * ejecucion.
 */
export function buildRunId(now: Date = new Date()): string {
  const iso = now.toISOString(); // 2026-08-02T11:38:00.123Z
  const datePart = iso.slice(0, 10); // 2026-08-02
  const timePart = iso.slice(11, 19).replace(/:/g, ""); // 113800
  return `seo-watcher-${datePart}T${timePart}Z`;
}
