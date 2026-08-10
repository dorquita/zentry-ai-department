import * as fs from "fs";
import * as path from "path";
import { resolveActiveClientPaths } from "./client-paths";

const LOGS_DIR = resolveActiveClientPaths().logsDir;
// "key(?!word)" evita el falso positivo de redactar el campo "keyword"
// (una keyword de SEO no es un secreto) sin dejar de detectar apiKey,
// privateKey, refreshToken, etc. "pass" (no solo "password") cubre tambien
// SMTP_PASS/smtpPass.
const SECRET_KEY_PATTERN = /(token|secret|pass|api[_-]?key|key(?!word))/i;

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Strips anything that looks like a credential before it can reach a log line.
 * The agent has no secrets to log today, but this stays in place as a hard
 * guardrail for when real API adapters are wired in later.
 */
function redact(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const clone: Record<string, unknown> = Array.isArray(value) ? [...(value as unknown[])] as unknown as Record<string, unknown> : { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      clone[key] = "[REDACTED]";
    } else if (typeof clone[key] === "object") {
      clone[key] = redact(clone[key]);
    }
  }
  return clone;
}

class Logger {
  private logFilePath: string;

  constructor() {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    this.logFilePath = path.join(LOGS_DIR, `seo-watcher-${dateStr}.log`);
  }

  private write(level: string, message: string, meta?: unknown): void {
    const safeMeta = meta !== undefined ? redact(meta) : undefined;
    const line = `[${timestamp()}] [${level}] ${message}${
      safeMeta !== undefined ? " " + JSON.stringify(safeMeta) : ""
    }`;
    console.log(line);
    fs.appendFileSync(this.logFilePath, line + "\n", "utf-8");
  }

  info(message: string, meta?: unknown): void {
    this.write("INFO", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write("WARN", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write("ERROR", message, meta);
  }
}

export const logger = new Logger();
