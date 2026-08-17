/**
 * Clasificacion de fallos del Claude Employee Runtime, y decision de si
 * un fallo concreto admite UN reintento controlado.
 *
 * FRONTERA DELIBERADA (igual que src/core/claude-employee-runtime.ts):
 * este modulo no sabe NADA de ningun dominio de negocio. Solo recibe el
 * error que lanzo `resolveClaudeEmployeeOutput()` y lo clasifica.
 *
 * POR QUE EXISTE (incidente P0 de fiabilidad de seo-specialist): la
 * causa raiz de ese incidente era que `--json-schema` quedaba INERTE
 * (ver `SIDE_EFFECT_FREE_SDK_TOOLS` en src/core/subagent-tool-guard.ts),
 * asi que el contrato dependia de que el modelo acertase el JSON a mano.
 * Con `StructuredOutput` concedido, el propio SDK valida y re-pregunta,
 * y ese modo de fallo casi desaparece -- pero "casi" no es "nunca": el
 * SDK tiene un limite de reintentos propio, y puede terminar sin
 * entregar salida estructurada. Este modulo existe para que ESE resto,
 * y solo ese, tenga un reintento explicito, medido y auditable.
 *
 * REGLA CENTRAL, FAIL-CLOSED: solo se reintenta lo que se ha podido
 * CLASIFICAR como variabilidad del modelo/servicio. Todo lo demas --
 * incluido cualquier fallo que no se sepa clasificar -- NO se reintenta.
 * Nunca se reintenta un fallo de autenticacion, de configuracion, de
 * schema no soportado, ni un fichero de ejecucion corrupto: reintentar
 * eso solo gastaria cuota y ocultaria un bug real detras de un segundo
 * intento igual de roto.
 */

export type ClaudeEmployeeFailureClass =
  /** El modelo devolvio texto que no es JSON parseable. Otra muestra puede salir bien. */
  | "model_output_unparseable"
  /** El modelo devolvio JSON, pero no cumple el JSON Schema versionado del empleado. Otra muestra puede salir bien. */
  | "model_output_schema_violation"
  /** La ejecucion termino sin entregar NINGUNA salida utilizable (ni structured_output ni un `result` recuperable). */
  | "no_output_delivered"
  /** El mensaje final del SDK reporta un fallo real de la ejecucion de Claude (subtype != success o is_error). */
  | "claude_run_failed"
  /** El propio execution_file esta corrupto o no tiene la forma que documenta el SDK -- eso es un problema de infraestructura, no del modelo. */
  | "infrastructure"
  /** No se ha podido clasificar. Fail-closed: NUNCA se reintenta. */
  | "unknown";

export interface ClaudeEmployeeFailureClassification {
  failureClass: ClaudeEmployeeFailureClass;
  /** true SOLO para las clases que son variabilidad del modelo/servicio y donde una muestra nueva puede legitimamente salir bien. */
  retryable: boolean;
  /** Motivo legible, pensado para el log del run y para el Step Summary. Nunca incluye el contenido generado por el modelo. */
  reason: string;
}

/**
 * Patrones de mensaje que produce `resolveClaudeEmployeeOutput()`. Son
 * mensajes NUESTROS (no de un tercero), definidos en
 * src/core/claude-employee-runtime.ts, asi que casar contra ellos es
 * estable -- y test/claude-employee-retry.test.ts fija cada uno de ellos
 * contra su clase para que un cambio de redaccion no reclasifique un
 * fallo en silencio.
 */
const PATTERNS: Array<{ pattern: RegExp; failureClass: ClaudeEmployeeFailureClass }> = [
  // Infraestructura PRIMERO: "execution_file invalido: no es JSON valido"
  // contiene tambien texto que podria confundirse con un fallo del
  // modelo, y el orden decide.
  { pattern: /execution_file invalido/i, failureClass: "infrastructure" },
  { pattern: /se esperaba un array de mensajes SDK/i, failureClass: "infrastructure" },
  { pattern: /no cumple el JSON Schema versionado/i, failureClass: "model_output_schema_violation" },
  { pattern: /no recuperable \(caso C\)/i, failureClass: "no_output_delivered" },
  { pattern: /no tiene un campo `result` de texto no vacio/i, failureClass: "no_output_delivered" },
  { pattern: /no se encontro ningun mensaje final de tipo "result"/i, failureClass: "no_output_delivered" },
  { pattern: /Fallo real de Claude, no recuperable/i, failureClass: "claude_run_failed" },
];

/** Unica fuente de verdad de que clases admiten reintento. */
const RETRYABLE_CLASSES: ReadonlySet<ClaudeEmployeeFailureClass> = new Set<ClaudeEmployeeFailureClass>([
  "model_output_unparseable",
  "model_output_schema_violation",
  "no_output_delivered",
  "claude_run_failed",
]);

export function isRetryableFailureClass(failureClass: ClaudeEmployeeFailureClass): boolean {
  return RETRYABLE_CLASSES.has(failureClass);
}

/**
 * Clasifica el error que lanzo `resolveClaudeEmployeeOutput()`.
 *
 * `SyntaxError` se trata aparte y ANTES que cualquier patron: es lo que
 * lanza `extractJsonFromModelResponse()` cuando el TEXTO DEL MODELO no
 * es JSON (`JSON.parse` sin envolver, comportamiento que
 * test/claude-employee-runtime.test.ts fija explicitamente). No
 * confundir con "execution_file invalido: no es JSON valido", que SI
 * viene envuelto en un Error normal porque describe el fichero que
 * escribio la Action, no lo que dijo el modelo.
 */
export function classifyClaudeEmployeeFailure(err: unknown): ClaudeEmployeeFailureClassification {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof SyntaxError) {
    return {
      failureClass: "model_output_unparseable",
      retryable: true,
      reason: "El modelo devolvio texto que no es JSON parseable (SyntaxError al parsear su respuesta).",
    };
  }

  for (const { pattern, failureClass } of PATTERNS) {
    if (pattern.test(message)) {
      return {
        failureClass,
        retryable: isRetryableFailureClass(failureClass),
        reason: message,
      };
    }
  }

  return {
    failureClass: "unknown",
    retryable: false,
    reason: `Fallo no clasificable, NO se reintenta (fail-closed): ${message}`,
  };
}
