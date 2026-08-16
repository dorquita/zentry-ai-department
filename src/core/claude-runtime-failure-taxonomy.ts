/**
 * Taxonomia de fallos del RUNTIME COMUN de empleados Claude
 * (`.github/actions/claude-employee-runtime/action.yml`).
 *
 * Existe para separar, con evidencia y no por intuicion, dos cosas que
 * antes se agrupaban bajo "el empleado fallo":
 *
 *   - fallos TRANSITORIOS de infraestructura (red, proveedor, la Action
 *     que se cae por dentro, un stream que muere antes de producir el
 *     mensaje final) -- reintentar tiene sentido porque el mismo input
 *     puede funcionar en otra pasada;
 *   - fallos DETERMINISTAS de contrato (auth, schema, dominio, politica
 *     de herramientas) -- reintentar solo gasta cuota y retrasa el
 *     diagnostico, asi que se falla en cerrado.
 *
 * FRONTERA: este modulo no sabe nada de ningun dominio de negocio, ni
 * invoca nada, ni decide politicas de reintento por su cuenta. Es una
 * funcion pura evidencia -> clasificacion. Quien reintenta es la
 * composite action, leyendo `retriable`.
 *
 * Ver docs/claude-runtime-reliability-incident.md.
 */

/**
 * Clases de fallo que el runtime sabe distinguir. Cualquier situacion
 * que no encaje en una clase conocida cae en `unknown_runtime_failure`,
 * que NO es reintentable a proposito: no se reintenta lo que no se sabe
 * explicar.
 */
export type ClaudeRuntimeFailureKind =
  | "auth_failure"
  | "network_failure"
  | "provider_transient_failure"
  | "timeout"
  | "action_internal_failure"
  | "no_output_at_all"
  | "execution_file_missing"
  | "execution_file_stale"
  | "execution_file_invalid"
  | "result_missing"
  | "result_not_json"
  | "schema_validation_failed"
  | "domain_validation_failed"
  | "tool_policy_failed"
  | "unknown_runtime_failure";

export interface ClaudeRuntimeFailureClassification {
  failureKind: ClaudeRuntimeFailureKind;
  /** Si esta clase admite un reintento ACOTADO con el MISMO input. */
  retriable: boolean;
  /** Por que esta clase es (o no es) reintentable -- texto estable, apto para Step Summary. */
  reason: string;
  /** Que se observo exactamente para clasificar asi -- nunca contiene el prompt ni ningun secreto. */
  evidence: string;
  /** Numero de intento (1-based) en el que se observo. */
  attempt: number;
}

interface FailureKindPolicy {
  retriable: boolean;
  reason: string;
}

/**
 * Politica por clase. Deliberadamente explicita y exhaustiva: anadir
 * una clase nueva obliga a decidir su politica aqui, no a heredar un
 * default silencioso.
 *
 * Los `retriable: true` son EXACTAMENTE las clases para las que la
 * evidencia del incidente muestra que el mismo input puede funcionar en
 * otra pasada porque lo que fallo fue la infraestructura, no la
 * respuesta del modelo ni el contrato.
 */
const FAILURE_KIND_POLICY: Record<ClaudeRuntimeFailureKind, FailureKindPolicy> = {
  auth_failure: {
    retriable: false,
    reason: "Credencial ausente, vacia o caducada. Reintentar da exactamente el mismo resultado y retrasa el aviso: hace falta renovar CLAUDE_CODE_OAUTH_TOKEN a mano.",
  },
  network_failure: {
    retriable: true,
    reason: "Fallo de red/transporte antes o durante la llamada. No depende del input; un segundo intento tiene una probabilidad real e independiente de exito.",
  },
  provider_transient_failure: {
    retriable: true,
    reason: "Error transitorio del proveedor (sobrecarga, 429/5xx, corte de stream). No depende del input.",
  },
  timeout: {
    retriable: false,
    reason: "La invocacion no cupo en el presupuesto de tiempo. Un reintento tampoco cabe dentro del mismo timeout-minutes del step, asi que reintentar solo duplica el coste sin cambiar el resultado. Hay que subir el presupuesto o reducir el trabajo, con una decision explicita.",
  },
  action_internal_failure: {
    retriable: true,
    reason: "La Action fallo por dentro despues de que Claude respondiera, sin dejar salida recuperable. No es un fallo de contrato del empleado.",
  },
  no_output_at_all: {
    retriable: true,
    reason: "La invocacion no dejo NINGUN rastro utilizable (ni structured_output ni execution_file). Es un fallo de infraestructura, no una respuesta invalida del modelo.",
  },
  execution_file_missing: {
    retriable: true,
    reason: "La Action no llego a publicar el execution_file (murio antes de escribirlo). El modelo no llego a entregar nada; reintentar es legitimo.",
  },
  execution_file_stale: {
    retriable: true,
    reason: "El execution_file encontrado pertenece a OTRA invocacion anterior del mismo job (ruta compartida $RUNNER_TEMP). Nunca se acepta como salida de este empleado. Esta invocacion no produjo fichero propio, asi que se trata como fallo de infraestructura.",
  },
  execution_file_invalid: {
    retriable: false,
    reason: "El execution_file existe pero no es un array de mensajes SDK parseable (truncado o corrupto). Fail-closed: no se adivina ni se repara contenido a medias.",
  },
  result_missing: {
    retriable: true,
    reason: "El stream del SDK termino sin mensaje final type=result. La ejecucion se corto por debajo del modelo, no es una respuesta invalida.",
  },
  result_not_json: {
    retriable: false,
    reason: "Claude SI respondio, pero su texto final no es JSON valido. Con structured_output activo el propio SDK ya reintenta y repara este caso por dentro; que llegue hasta aqui significa que el contrato fallo de verdad. Fail-closed.",
  },
  schema_validation_failed: {
    retriable: false,
    reason: "La salida es JSON valido pero incumple el JSON Schema versionado del empleado. Con structured_output activo el SDK ya re-pregunta ante un mismatch; llegar aqui indica un contrato o un schema que hay que corregir, no un fallo de suerte.",
  },
  domain_validation_failed: {
    retriable: false,
    reason: "La salida cumple el schema pero incumple una regla de negocio del empleado. Es un problema de contenido, no de infraestructura.",
  },
  tool_policy_failed: {
    retriable: false,
    reason: "El agente incumple la politica de herramientas (Subagent Tool Guard). Es configuracion del repositorio: reintentar no la cambia.",
  },
  unknown_runtime_failure: {
    retriable: false,
    reason: "No se ha podido clasificar el fallo con la evidencia disponible. No se reintenta lo que no se sabe explicar: se falla en cerrado y queda registrado para analizarlo.",
  },
};

export function isRetriableFailureKind(kind: ClaudeRuntimeFailureKind): boolean {
  return FAILURE_KIND_POLICY[kind].retriable;
}

export function describeFailureKind(kind: ClaudeRuntimeFailureKind): string {
  return FAILURE_KIND_POLICY[kind].reason;
}

export function classifyFailure(kind: ClaudeRuntimeFailureKind, evidence: string, attempt: number): ClaudeRuntimeFailureClassification {
  const policy = FAILURE_KIND_POLICY[kind];
  return { failureKind: kind, retriable: policy.retriable, reason: policy.reason, evidence, attempt };
}

/**
 * Patrones observables en el log/mensaje de error de la Action o del
 * SDK que identifican un fallo de transporte o de proveedor. Se
 * comparan contra el MENSAJE de error, nunca contra el prompt ni contra
 * la respuesta del modelo.
 *
 * El orden importa: `auth` se comprueba antes que el resto para que un
 * 401/403 no acabe clasificado como "transitorio" y se reintente en
 * bucle contra una credencial caducada.
 */
const ERROR_SIGNATURES: { kind: ClaudeRuntimeFailureKind; patterns: RegExp[] }[] = [
  {
    kind: "auth_failure",
    patterns: [/\b401\b/, /\b403\b/, /unauthorized/i, /forbidden/i, /authentication[_ ]?error/i, /invalid[_ ]?api[_ ]?key/i, /oauth[_ ]?token/i, /credentials?\b.*\b(invalid|expired|missing)/i],
  },
  {
    kind: "timeout",
    patterns: [/\btimed?[_ ]?out\b/i, /\betimedout\b/i, /deadline exceeded/i],
  },
  {
    kind: "network_failure",
    patterns: [/\beconnreset\b/i, /\beconnrefused\b/i, /\benotfound\b/i, /\beai_again\b/i, /\bepipe\b/i, /\bsocket hang up\b/i, /network (error|failure)/i, /fetch failed/i, /getaddrinfo/i],
  },
  {
    kind: "provider_transient_failure",
    patterns: [/\b429\b/, /\b5\d\d\b/, /rate[_ ]?limit/i, /overloaded/i, /server[_ ]?error/i, /service unavailable/i, /temporarily unavailable/i, /api_error/i, /stream (ended|closed) unexpectedly/i],
  },
];

/**
 * Clasifica un mensaje de error crudo (de la Action o del SDK) en una
 * clase de transporte/proveedor/auth/timeout. Devuelve `undefined` si
 * no reconoce ninguna firma -- quien llama decide entonces con el resto
 * de la evidencia, en vez de asumir "transitorio" por defecto.
 */
export function classifyErrorMessage(message: string | undefined): ClaudeRuntimeFailureKind | undefined {
  if (!message || message.trim().length === 0) return undefined;
  for (const { kind, patterns } of ERROR_SIGNATURES) {
    if (patterns.some((pattern) => pattern.test(message))) return kind;
  }
  return undefined;
}

/** Evidencia observable de UNA invocacion, recogida en el borde de la Action. Nunca incluye el prompt ni ningun secreto. */
export interface ClaudeInvocationEvidence {
  attempt: number;
  /** `outcome` real del step de claude-code-action ("success" | "failure"), sin enmascarar. */
  claudeOutcome: string | undefined;
  /** Contenido de `structured_output` (puede venir vacio). */
  structuredOutput: string | undefined;
  /** Ruta que la Action publico como `execution_file` (puede venir vacia). */
  executionFilePath: string | undefined;
  /** Si esa ruta existe de verdad en disco. */
  executionFileExists: boolean;
  /** Tamano en bytes del execution_file, si existe. */
  executionFileBytes: number | undefined;
  /**
   * Si el execution_file encontrado es de OTRA invocacion anterior del
   * mismo job. La Action escribe siempre en la MISMA ruta
   * ($RUNNER_TEMP/claude-execution-output.json), asi que en un job con
   * varios empleados un fichero sobreviviente puede no ser el de esta
   * invocacion. El runtime lo purga antes de invocar, y marca esto si
   * aun asi encuentra uno que no le corresponde.
   */
  executionFileStale?: boolean;
  /** Mensaje de error crudo de la Action/SDK, si lo hubo. */
  errorMessage?: string;
}

/**
 * Clasifica el fallo de una invocacion que NO produjo salida
 * recuperable. Solo debe llamarse cuando ya se ha intentado resolver la
 * salida y no ha sido posible: esta funcion no valida contenido, decide
 * en QUE CAPA se perdio.
 *
 * Prioridad deliberada: primero las firmas del mensaje de error (auth /
 * timeout / red / proveedor), porque son la causa mas concreta y la que
 * determina si reintentar sirve de algo; despues el estado del
 * execution_file; y solo al final las clases genericas.
 */
export function classifyInvocationFailure(evidence: ClaudeInvocationEvidence): ClaudeRuntimeFailureClassification {
  const { attempt } = evidence;

  const fromError = classifyErrorMessage(evidence.errorMessage);
  if (fromError) {
    return classifyFailure(fromError, `Firma reconocida en el error de la Action/SDK: "${truncateEvidence(evidence.errorMessage)}".`, attempt);
  }

  if (evidence.executionFileStale === true) {
    return classifyFailure(
      "execution_file_stale",
      `El execution_file en "${evidence.executionFilePath ?? "(sin ruta)"}" es de una invocacion anterior del mismo job; esta invocacion no dejo fichero propio.`,
      attempt
    );
  }

  const hasStructured = typeof evidence.structuredOutput === "string" && evidence.structuredOutput.trim().length > 0;

  if (!hasStructured && !evidence.executionFilePath) {
    return classifyFailure("no_output_at_all", `La Action no publico ni structured_output ni la ruta del execution_file (claude outcome="${evidence.claudeOutcome ?? "desconocido"}").`, attempt);
  }

  if (!hasStructured && evidence.executionFilePath && !evidence.executionFileExists) {
    return classifyFailure("execution_file_missing", `La Action publico execution_file="${evidence.executionFilePath}" pero el fichero no existe en disco.`, attempt);
  }

  if (!hasStructured && evidence.executionFileExists && (evidence.executionFileBytes ?? 0) === 0) {
    return classifyFailure("execution_file_invalid", `El execution_file "${evidence.executionFilePath}" existe pero esta vacio (0 bytes).`, attempt);
  }

  if (evidence.claudeOutcome === "failure") {
    return classifyFailure(
      "action_internal_failure",
      `El step de claude-code-action termino en "failure" y no quedo salida recuperable (execution_file bytes=${evidence.executionFileBytes ?? 0}).`,
      attempt
    );
  }

  return classifyFailure(
    "unknown_runtime_failure",
    `Claude outcome="${evidence.claudeOutcome ?? "desconocido"}", structured_output=${hasStructured ? "presente" : "ausente"}, execution_file="${evidence.executionFilePath ?? "(sin ruta)"}" existe=${evidence.executionFileExists} bytes=${evidence.executionFileBytes ?? 0}.`,
    attempt
  );
}

/** Recorta un mensaje de error para el registro -- evita volcar logs enteros en un artifact de diagnostico. */
function truncateEvidence(message: string | undefined, maxLength = 300): string {
  if (!message) return "";
  const collapsed = message.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength)}...`;
}
