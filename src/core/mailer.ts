import nodemailer from "nodemailer";
import { logger } from "./logger";
import { resolveActiveClientConfig, resolveActiveClientId, resolveClientSecret } from "./client-config";

/**
 * Envio de email por SMTP para el resumen diario del SEO Watcher Agent.
 * Solo envia un resumen de solo-lectura de lo detectado: nunca ejecuta
 * ninguna accion SEO real, nunca toca WordPress/Ads/GA4/GTM/n8n.
 *
 * Fase O16.1: el NOMBRE de la variable que guarda el destinatario ("to")
 * se lee de `notificationSettings.reportEmailToEnvVar` del ClientConfig
 * ACTIVO en vez del literal fijo `"REPORT_EMAIL_TO"` — para "zentry" ese
 * nombre es exactamente ese, asi que el comportamiento no cambia.
 *
 * Fase O16.2: la cuenta SMTP emisora (host/puerto/secure/usuario/pass/
 * from) SI pasa a ser por cliente (`<CLIENTID>_SMTP_HOST`, etc, con
 * fallback a las variables sin prefijo solo para "zentry") — un cliente
 * real querria enviar sus informes desde su propia cuenta de correo, no
 * desde la de Zentry.
 */

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Revisa .env.example para ver que hace falta configurar antes de enviar el email.`
    );
  }
  return value;
}

/**
 * Valida TODA la configuracion SMTP/email antes de intentar nada. Si falta
 * o es invalida cualquier variable, falla aqui con un error claro y NUNCA
 * llega a intentar conectar/enviar el email.
 */
export function resolveSmtpConfig(): SmtpConfig {
  const activeClientId = resolveActiveClientId();
  const host = resolveClientSecret(activeClientId, "SMTP_HOST");

  const portRaw = resolveClientSecret(activeClientId, "SMTP_PORT");
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`SMTP_PORT invalido: "${portRaw}". Debe ser un numero de puerto positivo.`);
  }

  const secureRaw = resolveClientSecret(activeClientId, "SMTP_SECURE").trim().toLowerCase();
  if (secureRaw !== "true" && secureRaw !== "false") {
    throw new Error(`SMTP_SECURE invalido: "${secureRaw}". Debe ser exactamente "true" o "false".`);
  }
  const secure = secureRaw === "true";

  const user = resolveClientSecret(activeClientId, "SMTP_USER");
  const pass = resolveClientSecret(activeClientId, "SMTP_PASS");
  const from = resolveClientSecret(activeClientId, "REPORT_EMAIL_FROM");
  const toEnvVar = resolveActiveClientConfig().notificationSettings.reportEmailToEnvVar;
  const to = requireEnv(toEnvVar);

  return { host, port, secure, user, pass, from, to };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Defensa en profundidad sobre la redaccion generica del logger: por si un
 * error de SMTP incluyera el valor literal de la contrasena en su mensaje
 * (algunos servidores lo hacen en errores de autenticacion), se quita aqui
 * explicitamente antes de loguear o relanzar.
 */
function sanitizeSmtpError(err: unknown, pass: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const withoutPass = pass
    ? raw.replace(new RegExp(escapeRegExp(pass), "gi"), "[REDACTED]")
    : raw;
  return withoutPass.length > 500 ? withoutPass.slice(0, 500) + "...[truncated]" : withoutPass;
}

export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

export async function sendReportEmail(content: EmailContent): Promise<void> {
  const config = resolveSmtpConfig();

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });

  try {
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    logger.info("Email de informe SEO enviado", {
      to: config.to,
      from: config.from,
      subject: content.subject,
    });
  } catch (err) {
    const safeMessage = sanitizeSmtpError(err, config.pass);
    logger.error("Fallo el envio del email de informe SEO", { error: safeMessage });
    throw new Error(`Envio de email fallo: ${safeMessage}`);
  }
}
