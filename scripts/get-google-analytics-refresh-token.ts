/**
 * Genera un UNICO refresh token OAuth2 de SOLO LECTURA compartido por
 * GA4 y GTM (mismo diseno que src/adapters/ga4.ts / src/adapters/gtm.ts,
 * ver docs/analytics-readonly.md).
 *
 * Scopes solicitados (los 2 a la vez, en la misma pantalla de consentimiento):
 *   - https://www.googleapis.com/auth/analytics.readonly
 *   - https://www.googleapis.com/auth/tagmanager.readonly
 *
 * Mismo patron y garantias que `npm run auth:gsc` / `npm run auth:google-ads`:
 *   1. Reutiliza GOOGLE_ANALYTICS_OAUTH_CLIENT_ID/SECRET si ya estan en
 *      .env (no los vuelve a pedir ni los imprime). Si no estan, los pide
 *      con entrada enmascarada.
 *   2. Genera una URL de autorizacion (access_type=offline, prompt=consent,
 *      AMBOS scopes) para abrir en cualquier navegador. TU inicias sesion
 *      y confirmas el consentimiento — veras que la pantalla pide acceso
 *      de solo lectura a Analytics Y a Tag Manager en un unico paso.
 *   3. Pide el authorization code manualmente (entrada enmascarada).
 *   4. Intercambia el code por tokens y muestra el refresh token
 *      ENMASCARADO (nunca completo).
 *   5. Antes de guardar, hace un backup de .env (permisos 600 preservados)
 *      y pregunta explicitamente si quieres guardar. Si dices que no,
 *      nada se persiste.
 *
 * Que NO hace:
 *   - No crea key events en GA4, no publica ninguna version de contenedor
 *     GTM, no modifica tags/triggers/variables — este script solo obtiene
 *     un token de autenticacion, no ejecuta ninguna llamada a la GA4 Data
 *     API ni a la API de Tag Manager mas alla del intercambio OAuth2
 *     estandar (token endpoint de Google).
 *   - No toca Google Ads, WordPress, n8n ni qdrant.
 *   - No imprime el Client Secret ni el refresh token completos en ningun
 *     momento (solo version enmascarada).
 *   - No guarda nada en disco sin confirmacion explicita del usuario.
 *   - No modifica ninguna otra clave del .env aparte de las 3 indicadas
 *     al confirmar.
 *
 * Uso: npm run auth:analytics
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/tagmanager.readonly",
];
const DEFAULT_REDIRECT_URI = "http://localhost";
const ENV_PATH = path.join(__dirname, "..", ".env");

const CHAR_ENTER_LF = String.fromCharCode(10);
const CHAR_ENTER_CR = String.fromCharCode(13);
const CHAR_CTRL_D = String.fromCharCode(4);
const CHAR_CTRL_C = String.fromCharCode(3);
const CHAR_BACKSPACE = String.fromCharCode(8);
const CHAR_DEL = String.fromCharCode(127);

function maskedPrompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const canMask = typeof stdin.setRawMode === "function" && stdin.isTTY;

    process.stdout.write(question);

    if (!canMask) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", (answer: string) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    let input = "";
    stdin.resume();
    stdin.setRawMode!(true);
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      const char = chunk.toString();

      if (char === CHAR_ENTER_LF || char === CHAR_ENTER_CR || char === CHAR_CTRL_D) {
        stdin.setRawMode!(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
        return;
      }

      if (char === CHAR_CTRL_C) {
        process.stdout.write("\n");
        process.exit(1);
      }

      if (char === CHAR_BACKSPACE || char === CHAR_DEL) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write(CHAR_BACKSPACE + " " + CHAR_BACKSPACE);
        }
        return;
      }

      input += char;
      process.stdout.write("*");
    };

    stdin.on("data", onData);
  });
}

function plainPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}

function maskSecret(value: string, visibleTail = 4): string {
  if (value.length <= visibleTail) return "*".repeat(value.length);
  return "*".repeat(value.length - visibleTail) + value.slice(-visibleTail);
}

async function resolveCredential(envVar: string, label: string): Promise<string> {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    console.log(`${label}: usando ${envVar} ya definido en el entorno/.env (no se imprime).`);
    return fromEnv;
  }
  const value = await maskedPrompt(`${label} (no se mostrara en pantalla): `);
  if (!value.trim()) {
    console.error(`${label} vacio. Abortando.`);
    process.exit(1);
  }
  return value.trim();
}

function backupEnvFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const backupPath = `${filePath}.bak.${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  try {
    fs.chmodSync(backupPath, 0o600);
  } catch {
    // best-effort; algunos filesystems no soportan chmod POSIX
  }
  return backupPath;
}

function upsertEnvFile(filePath: string, updates: Record<string, string>): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const remainingKeys = new Set(Object.keys(updates));

  const merged = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && remainingKeys.has(match[1])) {
      remainingKeys.delete(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });

  for (const key of remainingKeys) {
    merged.push(`${key}=${updates[key]}`);
  }

  const content = merged.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : content + "\n", {
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

async function main() {
  console.log("=== Refresh token OAuth2 de solo lectura compartido para GA4 + GTM ===");
  console.log(`Scopes solicitados (ambos a la vez): ${SCOPES.join(", ")}`);
  console.log(
    "Este script SOLO obtiene un token de autenticacion — no crea key events en GA4, no"
  );
  console.log(
    "publica ninguna version de contenedor GTM, no modifica tags/triggers/variables."
  );
  console.log("Ver docs/analytics-readonly.md.");
  console.log("");

  const clientId = await resolveCredential("GOOGLE_ANALYTICS_OAUTH_CLIENT_ID", "Client ID");
  const clientSecret = await resolveCredential("GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET", "Client Secret");
  const redirectUri = process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("");
  console.log("1) Abre esta URL en cualquier navegador (no hace falta que sea en este servidor)");
  console.log("   e inicia sesion con la cuenta de Google que tiene acceso a GA4 (property 544190531)");
  console.log("   y a GTM (contenedor 257386510). Veras UNA pantalla de consentimiento pidiendo");
  console.log("   acceso de solo lectura a Analytics Y a Tag Manager:");
  console.log("");
  console.log(authUrl);
  console.log("");
  console.log(
    `2) Tras aceptar, Google redirigira a "${redirectUri}/?code=...". Es normal que esa`
  );
  console.log("   pagina de un error de carga (no hay nada escuchando ahi). Copia SOLO el");
  console.log('   valor del parametro "code" de la barra de direcciones del navegador.');
  console.log("");

  const code = await maskedPrompt("3) Pega aqui el authorization code (no se mostrara en pantalla): ");
  if (!code.trim()) {
    console.error("Authorization code vacio. Abortando.");
    process.exit(1);
  }

  console.log("");
  console.log(
    "Intercambiando el authorization code por tokens (llamada estandar de OAuth2, sin acciones sobre GA4/GTM)..."
  );

  let tokens;
  try {
    const result = await oauth2Client.getToken(code.trim());
    tokens = result.tokens;
  } catch (err) {
    console.error(
      "Fallo el intercambio del authorization code:",
      err instanceof Error ? err.message : String(err)
    );
    process.exit(1);
  }

  if (!tokens.refresh_token) {
    console.error("");
    console.error("Google no devolvio un refresh_token.");
    console.error(
      "Esto suele pasar si esta combinacion de cuenta + app ya tenia un acceso concedido previamente."
    );
    console.error(
      "Revoca el acceso previo en https://myaccount.google.com/permissions y vuelve a ejecutar este script."
    );
    process.exit(1);
  }

  console.log("");
  console.log("OK: refresh token obtenido (solo lectura, scopes analytics.readonly + tagmanager.readonly).");
  console.log(`Refresh token (enmascarado): ${maskSecret(tokens.refresh_token)}`);
  console.log("El valor completo NO se imprime en esta consola en ningun momento.");
  console.log("");

  const confirm = await plainPrompt(
    `Guardar automaticamente en ${ENV_PATH}? Antes de escribir se creara un backup del .env actual.\n` +
      "Se anadiran/actualizaran SOLO estas claves (GOOGLE_ANALYTICS_OAUTH_CLIENT_ID,\n" +
      "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET, GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN), el resto del\n" +
      'fichero no se toca. Escribe "si" para confirmar: '
  );

  if (confirm.trim().toLowerCase() === "si" || confirm.trim().toLowerCase() === "s") {
    const backupPath = backupEnvFile(ENV_PATH);
    if (backupPath) {
      console.log(`Backup creado: ${backupPath} (permisos 600).`);
    }
    upsertEnvFile(ENV_PATH, {
      GOOGLE_ANALYTICS_OAUTH_CLIENT_ID: clientId,
      GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: clientSecret,
      GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN: tokens.refresh_token,
    });
    console.log("");
    console.log(`Guardado en ${ENV_PATH} (permisos 600). El valor completo no se ha impreso en ningun momento.`);
    console.log("Revisa que GA4_PROPERTY_ID, GA4_MEASUREMENT_ID, GTM_CONTAINER_ID y GTM_WORKSPACE_ID");
    console.log("sigan configurados en ese .env — este script no los toca.");
    console.log("Siguiente paso: npm run typecheck && npm run growth:daily");
  } else {
    console.log("");
    console.log("No se ha guardado nada en disco. Por diseno, el refresh token completo no queda");
    console.log("accesible en ningun sitio (ni en pantalla ni en log). Vuelve a ejecutar este script");
    console.log("y confirma el guardado cuando quieras activarlo.");
  }

  process.exit(0);
}

main();
