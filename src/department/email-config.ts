/**
 * Configuracion del envio del Daily Brief por email -- resolucion
 * FAIL-CLOSED y sin exponer NUNCA ningun valor.
 *
 * Modulo puro: recibe el entorno como parametro (no lee `process.env` por
 * su cuenta) y devuelve, o bien el destinatario resuelto, o bien la lista
 * de NOMBRES de variables que faltan. Nunca devuelve, registra ni
 * concatena el VALOR de ninguna variable salvo el destinatario, que es el
 * unico dato que el propio email necesita (y que ya aparece en la
 * cabecera del correo).
 *
 * Reutiliza la infraestructura de email que YA existe en el proyecto
 * (SMTP + nodemailer en src/core/mailer.ts, con su saneado de errores y
 * su redaccion de secretos): aqui solo se decide el destinatario y si hay
 * configuracion suficiente para intentar el envio.
 */

/** Variable dedicada al Daily Brief del departamento. Es la preferida. */
export const DAILY_BRIEF_EMAIL_TO_VAR = "DAILY_BRIEF_EMAIL_TO";

/** Variables SMTP que el mailer del proyecto necesita para poder enviar. */
export const REQUIRED_SMTP_VARS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "REPORT_EMAIL_FROM"] as const;

export interface DailyBriefEmailConfigInput {
  env: Record<string, string | undefined>;
  /**
   * Nombre de la variable de destinatario del cliente activo
   * (`notificationSettings.reportEmailToEnvVar`, hoy `REPORT_EMAIL_TO`).
   * Se usa SOLO como fallback si no existe `DAILY_BRIEF_EMAIL_TO`.
   */
  fallbackRecipientVar: string;
}

export type DailyBriefEmailConfig =
  | { configured: true; to: string; recipientVar: string; missing: [] }
  | { configured: false; to: null; recipientVar: null; missing: string[]; reason: string };

function readNonEmpty(env: Record<string, string | undefined>, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Decide si se puede enviar el Daily Brief y a quien. Si falta algo,
 * devuelve los NOMBRES exactos de las variables que hay que crear -- para
 * que el operador sepa que configurar sin tener que leer codigo, y sin
 * que ningun valor aparezca jamas en un log.
 */
export function resolveDailyBriefEmailConfig(input: DailyBriefEmailConfigInput): DailyBriefEmailConfig {
  const missing: string[] = [];
  for (const name of REQUIRED_SMTP_VARS) {
    if (!readNonEmpty(input.env, name)) missing.push(name);
  }

  const preferred = readNonEmpty(input.env, DAILY_BRIEF_EMAIL_TO_VAR);
  const fallback = readNonEmpty(input.env, input.fallbackRecipientVar);
  const to = preferred ?? fallback;
  const recipientVar = preferred ? DAILY_BRIEF_EMAIL_TO_VAR : fallback ? input.fallbackRecipientVar : null;

  if (!to) missing.push(`${DAILY_BRIEF_EMAIL_TO_VAR} (o, como alternativa, ${input.fallbackRecipientVar})`);

  if (missing.length > 0 || !to || !recipientVar) {
    return {
      configured: false,
      to: null,
      recipientVar: null,
      missing,
      reason: `Falta configuracion de email: ${missing.join(", ")}. Fail-closed: NO se envia ningun correo. Crea esos secretos/variables (solo los NOMBRES aparecen aqui; ningun valor se registra nunca).`,
    };
  }

  return { configured: true, to, recipientVar, missing: [] };
}

/**
 * Comprueba que un texto que va a imprimirse no contiene el valor de
 * ninguna variable sensible del entorno. Defensa en profundidad sobre el
 * saneado del logger y del mailer: se usa antes de volcar el email al log
 * de un run publico.
 */
export function containsSecretValue(text: string, env: Record<string, string | undefined>, sensitiveVars: string[]): string | null {
  for (const name of sensitiveVars) {
    const value = env[name];
    // Valores muy cortos (p.ej. "true"/"false"/un puerto) no son
    // secretos y coincidirian con cualquier texto: se ignoran a
    // proposito, igual que hace el logger del proyecto.
    if (typeof value === "string" && value.trim().length >= 8 && text.includes(value.trim())) return name;
  }
  return null;
}
