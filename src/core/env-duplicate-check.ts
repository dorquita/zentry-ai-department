import * as fs from "fs";
import * as path from "path";
import { CLIENT_SERVICE_CREDENTIAL_KEYS } from "./client-config";

/**
 * Fase O49.5 — detector de claves OAuth duplicadas en `.env`.
 *
 * Causa real que motiva este modulo (2026-08-14): `scripts/get-google-
 * analytics-refresh-token.ts` escribio correctamente un refresh token
 * nuevo y valido, pero una linea VACIA duplicada de la misma clave, mas
 * abajo en el fichero, lo pisaba en silencio (dotenv resuelve claves
 * repetidas con "la ultima gana") -- el resultado eran fallos
 * `invalid_grant`/"no refresh token" indistinguibles de un token
 * realmente caducado, sin ningun aviso de que la causa era un duplicado,
 * no la credencial en si.
 *
 * Lee el `.env` en crudo (nunca via `dotenv.config()`, que ya resuelve/
 * oculta duplicados antes de que este modulo pueda verlos) y busca
 * duplicados SOLO entre las claves OAuth de los 4 servicios que dependen
 * de refresh tokens (search_console, google_ads, ga4, gtm — reutiliza el
 * mismo catalogo cerrado de `CLIENT_SERVICE_CREDENTIAL_KEYS` en
 * `client-config.ts`, para no mantener una segunda lista separada que
 * pueda desincronizarse). Nunca devuelve ni registra el VALOR de ninguna
 * clave — solo el nombre de la clave y en que lineas aparece.
 */

const ENV_PATH = path.join(__dirname, "..", "..", ".env");

const OAUTH_SERVICES = ["search_console", "google_ads", "ga4", "gtm"] as const;

function oauthKeysToCheck(): string[] {
  const set = new Set<string>();
  for (const service of OAUTH_SERVICES) {
    for (const key of CLIENT_SERVICE_CREDENTIAL_KEYS[service]) set.add(key);
  }
  return [...set];
}

export interface EnvDuplicateFinding {
  key: string;
  occurrences: number;
  lineNumbers: number[];
}

/**
 * Devuelve las claves de `keys` (por defecto, las OAuth de los 4
 * servicios) que aparecen mas de una vez como asignacion de linea
 * (`CLAVE=...`) en `envPath`. Lista vacia si el fichero no existe o no
 * hay duplicados -- nunca lanza, pensado para poder llamarse en cada
 * pasada diaria sin arriesgar el pipeline.
 */
export function findDuplicateEnvKeys(envPath: string = ENV_PATH, keys: string[] = oauthKeysToCheck()): EnvDuplicateFinding[] {
  try {
    if (!fs.existsSync(envPath)) return [];
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    const keySet = new Set(keys);
    const seen = new Map<string, number[]>();
    lines.forEach((line, idx) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
      if (match && keySet.has(match[1])) {
        const arr = seen.get(match[1]) ?? [];
        arr.push(idx + 1);
        seen.set(match[1], arr);
      }
    });
    const findings: EnvDuplicateFinding[] = [];
    for (const [key, lineNumbers] of seen.entries()) {
      if (lineNumbers.length > 1) findings.push({ key, occurrences: lineNumbers.length, lineNumbers });
    }
    return findings;
  } catch {
    return [];
  }
}

/** Linea lista para el informe ejecutivo -- nunca incluye el valor de la clave, solo su nombre y lineas. */
export function describeEnvDuplicate(finding: EnvDuplicateFinding): string {
  return `ALERTA: la variable "${finding.key}" aparece ${finding.occurrences} veces en .env (lineas ${finding.lineNumbers.join(", ")}) -- con dotenv, la ULTIMA definicion gana y puede estar pisando en silencio un valor correcto con uno vacio o antiguo. Dejar una unica definicion de esta clave.`;
}
