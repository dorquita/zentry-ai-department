/**
 * Genera un refresh token OAuth2 de SOLO LECTURA para Google Search Console.
 *
 * Scope solicitado (unico): https://www.googleapis.com/auth/webmasters.readonly
 *
 * Que hace:
 *   1. Pide Client ID y Client Secret (de OAuth2, tipo "Desktop app" en
 *      Google Cloud Console) sin hacer eco en pantalla, salvo que ya
 *      esten en variables de entorno / .env.
 *   2. Genera una URL de autorizacion (access_type=offline, prompt=consent,
 *      scope de solo lectura) para que la abras en cualquier navegador.
 *   3. Pide el authorization code manualmente (sin hacer eco en pantalla).
 *   4. Intercambia el code por tokens y muestra el refresh token
 *      ENMASCARADO (nunca completo).
 *   5. Pregunta explicitamente si quieres guardarlo en .env. Si dices que
 *      no, el script NO lo persiste en ningun sitio y el valor completo
 *      queda inaccesible (habria que repetir el proceso).
 *
 * Que NO hace:
 *   - No usa service account JSON.
 *   - No usa Workload Identity Federation.
 *   - No toca iam.disableServiceAccountKeyCreation ni ninguna config de IAM.
 *   - No toca WordPress, Google Ads, GA4, GTM, n8n ni qdrant.
 *   - No imprime el Client Secret ni el refresh token completos en ningun
 *     momento (solo version enmascarada).
 *   - No guarda nada en disco sin confirmacion explicita del usuario.
 *
 * Uso: npm run auth:gsc
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { google } from "googleapis";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_REDIRECT_URI = "http://localhost";
const ENV_PATH = path.join(__dirname, "..", ".env");

// Codigos de control relevantes, construidos por punto de codigo (nunca
// tecleados como bytes literales en el fuente, para evitar corrupcion).
const CHAR_ENTER_LF = String.fromCharCode(10); // salto de linea
const CHAR_ENTER_CR = String.fromCharCode(13); // retorno de carro
const CHAR_CTRL_D = String.fromCharCode(4); // EOF
const CHAR_CTRL_C = String.fromCharCode(3); // interrumpir
const CHAR_BACKSPACE = String.fromCharCode(8); // backspace
const CHAR_DEL = String.fromCharCode(127); // delete

function maskedPrompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const canMask = typeof stdin.setRawMode === "function" && stdin.isTTY;

    process.stdout.write(question);

    if (!canMask) {
      // Fallback sin terminal interactivo (p.ej. pipes/CI): eco normal.
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
    // best-effort; algunos filesystems no soportan chmod POSIX
  }
}

async function main() {
  console.log("=== Refresh token OAuth2 de solo lectura para Google Search Console ===");
  console.log(`Scope solicitado (unico): ${SCOPE}`);
  console.log("No se usa service account JSON. No se usa Workload Identity Federation.");
  console.log("");

  const clientId = await resolveCredential("GSC_OAUTH_CLIENT_ID", "Client ID");
  const clientSecret = await resolveCredential("GSC_OAUTH_CLIENT_SECRET", "Client Secret");
  const redirectUri = process.env.GSC_OAUTH_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [SCOPE],
  });

  console.log("");
  console.log("1) Abre esta URL en cualquier navegador (no hace falta que sea en este servidor)");
  console.log("   e inicia sesion con la cuenta de Google que tiene acceso a Search Console.");
  console.log("   Veras una pantalla de consentimiento pidiendo SOLO acceso de lectura a Search Console:");
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
    "Intercambiando el authorization code por tokens (llamada estandar de OAuth2, sin acciones SEO)..."
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
  console.log("OK: refresh token obtenido (solo lectura).");
  console.log(`Refresh token (enmascarado): ${maskSecret(tokens.refresh_token)}`);
  console.log("El valor completo NO se imprime en esta consola en ningun momento.");
  console.log("");

  const confirm = await plainPrompt(
    `Guardar automaticamente en ${ENV_PATH}? Se anadiran/actualizaran SOLO estas claves\n` +
      "(SEO_DATA_SOURCE, GSC_AUTH_METHOD, GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_OAUTH_REFRESH_TOKEN),\n" +
      'el resto del fichero (si existe) no se toca. Escribe "si" para confirmar: '
  );

  if (confirm.trim().toLowerCase() === "si" || confirm.trim().toLowerCase() === "s") {
    upsertEnvFile(ENV_PATH, {
      SEO_DATA_SOURCE: "search_console",
      GSC_AUTH_METHOD: "oauth2",
      GSC_OAUTH_CLIENT_ID: clientId,
      GSC_OAUTH_CLIENT_SECRET: clientSecret,
      GSC_OAUTH_REFRESH_TOKEN: tokens.refresh_token,
    });
    console.log("");
    console.log(`Guardado en ${ENV_PATH} (permisos 600). El valor completo no se ha impreso en ningun momento.`);
    console.log("Revisa que GSC_SITE_URL en ese .env apunte a la propiedad correcta antes de usarlo.");
  } else {
    console.log("");
    console.log("No se ha guardado nada en disco. Por diseno, el refresh token completo no queda");
    console.log("accesible en ningun sitio (ni en pantalla ni en log). Vuelve a ejecutar este script");
    console.log("y confirma el guardado cuando quieras activarlo.");
  }

  process.exit(0);
}

main();
