import { emitEvent } from "./department-events";
import { logger } from "./logger";

/**
 * Fase O49 — aislamiento por paso del pase diario.
 *
 * Antes de esta fase, un solo paso que lanzara una excepcion (ej.
 * invalid_grant de una credencial OAuth caducada) tiraba abajo las 26
 * etapas del pase diario ANTES de llegar al email — el 2026-08-10 el
 * pase automatico de las 08:00 fallo al 100% y no se envio nada hasta que
 * alguien lo relanzo a mano. `runPipelineStep` ejecuta un paso, y si
 * lanza, lo registra (log + evento `step_failed` en el bus del
 * departmentRunId) y devuelve `null` en vez de propagar la excepcion —
 * el orquestador sigue con el siguiente paso. Los pasos 25/26 (Growth
 * Director + email) SIEMPRE deben ejecutarse si se llego hasta ahi,
 * aunque pasos anteriores hayan fallado.
 */
export async function runPipelineStep<T>(
  departmentRunId: string,
  stepNumber: number,
  totalSteps: number,
  agentName: string,
  label: string,
  fn: () => Promise<T>
): Promise<T | null> {
  console.log(`\n[${stepNumber}/${totalSteps}] ${label}...`);
  try {
    return await fn();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Paso ${stepNumber}/${totalSteps} (${agentName}) fallo, el pase diario continua con el resto`, {
      error: errorMessage,
    });
    console.log(`  [ERROR] ${agentName} fallo: ${errorMessage} — el pase diario continua con el siguiente paso.`);
    try {
      emitEvent({
        departmentRunId,
        agent: agentName,
        type: "step_failed",
        priority: "high",
        summary: `${agentName} (paso ${stepNumber}/${totalSteps}) fallo: ${errorMessage}`,
        payload: { stepNumber, totalSteps, error: errorMessage },
      });
    } catch (eventErr) {
      // Si ni siquiera se puede escribir el evento de fallo, no volver a
      // lanzar — el objetivo de esta funcion es precisamente que un fallo
      // nunca tire abajo el resto del pase diario.
      logger.error("No se pudo registrar el evento step_failed", {
        error: eventErr instanceof Error ? eventErr.message : String(eventErr),
      });
    }
    return null;
  }
}
