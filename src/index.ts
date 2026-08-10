/**
 * Punto de entrada central del "departamento IA" de Zentry/Tukandado.
 *
 * Hoy solo existe un agente (SEO Watcher, ver src/agents/seo-watcher.ts),
 * asi que se ejecuta directamente via `npm run seo:watch`
 * (scripts/run-seo-watcher.ts).
 *
 * Este archivo queda como el futuro punto de entrada del Agente Director,
 * que registrara y orquestara todos los agentes de todos los departamentos
 * (ver docs/vision.md y docs/department-map.md).
 */
export { runSeoWatcher } from "./agents/seo-watcher";
