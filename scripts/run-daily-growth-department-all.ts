/**
 * Fase O16.3/O16.4 — pase diario MULTI-CLIENTE. Lee config/active-clients.json
 * y ejecuta, para cada cliente `enabled !== false`, el MISMO script de
 * siempre (`scripts/run-daily-growth-department.ts`) como un proceso hijo
 * aislado -- si un cliente falla o cuelga, no afecta a los demas ni al
 * proceso padre. Termina escribiendo un resumen multi-cliente (consola +
 * `reports/multi-client/daily-summary-<fecha>.md`).
 *
 * Uso:
 *   npm run growth:daily:all
 *
 * Invariante de seguridad ABSOLUTA (no configurable, no hay override):
 * si `clients/<id>/client.config.json` tiene `isSandbox: true`, ese
 * cliente SIEMPRE se ejecuta en modo `--dry-run`, sin excepcion --
 * `config/active-clients.json` puede pedir `dryRun: false` para un
 * cliente sandbox y sera IGNORADO (con un aviso explicito en el
 * resumen). Esto replica exactamente la misma regla que ya aplica
 * `scripts/run-daily-growth-department.ts` para invocaciones
 * individuales (Fase O16).
 *
 * No envia ningun email adicional "multi-cliente": cada cliente sigue
 * enviando (o no) su propio email exactamente igual que si se hubiera
 * invocado `npm run growth:daily -- --client <id>` a mano. El resumen
 * multi-cliente es SOLO un fichero — nunca un email.
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { loadClientConfig, ClientConfigError } from "../src/core/client-config";

const PROJECT_ROOT = path.join(__dirname, "..");
const ACTIVE_CLIENTS_PATH = path.join(PROJECT_ROOT, "config", "active-clients.json");
const MULTI_CLIENT_REPORTS_DIR = path.join(PROJECT_ROOT, "reports", "multi-client");
const SINGLE_CLIENT_SCRIPT = path.join(PROJECT_ROOT, "scripts", "run-daily-growth-department.ts");

interface ActiveClientEntry {
  clientId: string;
  enabled?: boolean;
  dryRun?: boolean;
}

interface ActiveClientsFile {
  clients: ActiveClientEntry[];
}

interface ClientRunSummary {
  clientId: string;
  status: "success" | "failed" | "skipped_disabled" | "skipped_not_found";
  isSandbox: boolean | null;
  dryRun: boolean;
  sandboxOverrideIgnored: boolean;
  durationMs: number;
  errorMessage?: string;
  seoOpportunities: number | null;
  contentProposals: number | null;
  competitorKeywordGaps: number | null;
  proposalsPreparedForReview: number | null;
  pendingApprovals: number | null;
  googleAdsConnected: boolean | null;
  ga4Connected: boolean | null;
  gtmConnected: boolean | null;
  wordpressDraftsEnabled: boolean | null;
  stagingHealthy: boolean | null;
  productionTouched: boolean | null;
  riskLines: string[];
}

function loadActiveClients(): ActiveClientEntry[] {
  if (!fs.existsSync(ACTIVE_CLIENTS_PATH)) {
    throw new Error(
      `No existe config/active-clients.json. Crealo primero (ver docs/multi-client-architecture.md, seccion "Bucle multi-cliente").`
    );
  }
  const raw = fs.readFileSync(ACTIVE_CLIENTS_PATH, "utf-8");
  let parsed: ActiveClientsFile;
  try {
    parsed = JSON.parse(raw) as ActiveClientsFile;
  } catch (err) {
    throw new Error(`config/active-clients.json no es JSON valido: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed.clients) || parsed.clients.length === 0) {
    throw new Error(`config/active-clients.json debe tener un array "clients" no vacio.`);
  }
  return parsed.clients;
}

function extractBool(output: string, regex: RegExp): boolean | null {
  const m = output.match(regex);
  if (!m) return null;
  return m[1] === "true";
}

function extractNumber(output: string, regex: RegExp): number | null {
  const m = output.match(regex);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parseo best-effort del stdout YA IMPRESO por el pase de un solo
 * cliente (nunca cambia ni reinterpreta datos reales, solo extrae
 * numeros/booleanos que el propio orquestador de un cliente ya imprime
 * en consola). Si un pase fue dry-run, la mayoria de estos campos
 * quedan `null` ("n/d") porque ese pase nunca los genero -- es
 * exactamente lo esperado, no un fallo de parseo.
 */
function parseSingleClientOutput(output: string): Pick<
  ClientRunSummary,
  | "seoOpportunities"
  | "contentProposals"
  | "competitorKeywordGaps"
  | "proposalsPreparedForReview"
  | "pendingApprovals"
  | "googleAdsConnected"
  | "ga4Connected"
  | "gtmConnected"
  | "wordpressDraftsEnabled"
  | "stagingHealthy"
  | "productionTouched"
  | "riskLines"
> {
  const preparedMatch = output.match(/(\d+) propuesta\(s\) preparada\(s\)(?:, (\d+) por aprobar)?/);
  // Heuristica deliberadamente estricta: solo lineas con una palabra de
  // riesgo real Y (si tienen un contador tipo "algo=N") ese contador es
  // != 0 -- evita marcar como "riesgo" lineas benignas tipo
  // "bloqueadas=0"/"fallan=0" solo porque contienen la palabra.
  const riskLines = Array.from(
    new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => {
          if (!/\bFALLO\b|advertencia|Sin credenciales|no configurad[oa]/i.test(line) && !/(bloqueadas|fallidas|fallan)=\d+/.test(line)) {
            return false;
          }
          const counterMatch = line.match(/(bloqueadas|fallidas|fallan)=(\d+)/);
          if (counterMatch && counterMatch[2] === "0") {
            return false;
          }
          return true;
        })
    )
  ).slice(0, 5);

  return {
    seoOpportunities: extractNumber(output, /(\d+) oportunidad\(es\)/),
    contentProposals: extractNumber(output, /(\d+) propuesta\(s\) de contenido/),
    competitorKeywordGaps: extractNumber(output, /(\d+) gap\(s\) de keyword/),
    proposalsPreparedForReview: preparedMatch ? Number(preparedMatch[1]) : null,
    pendingApprovals: preparedMatch && preparedMatch[2] !== undefined ? Number(preparedMatch[2]) : preparedMatch ? 0 : null,
    googleAdsConnected: extractBool(output, /conectado=(true|false), campana=/),
    ga4Connected: extractBool(output, /GA4 conectado=(true|false)/),
    gtmConnected: extractBool(output, /GTM conectado=(true|false)/),
    wordpressDraftsEnabled: extractBool(output, /wordpress_drafts_enabled=(true|false)/),
    stagingHealthy: extractBool(output, /staging_200=(true|false)/),
    productionTouched: extractBool(output, /produccion_tocada=(true|false)/),
    riskLines,
  };
}

function runSingleClient(entry: ActiveClientEntry): ClientRunSummary {
  const startedAt = Date.now();
  const base: Omit<
    ClientRunSummary,
    | "status"
    | "durationMs"
    | "seoOpportunities"
    | "contentProposals"
    | "competitorKeywordGaps"
    | "proposalsPreparedForReview"
    | "pendingApprovals"
    | "googleAdsConnected"
    | "ga4Connected"
    | "gtmConnected"
    | "wordpressDraftsEnabled"
    | "stagingHealthy"
    | "productionTouched"
    | "riskLines"
  > = {
    clientId: entry.clientId,
    isSandbox: null,
    dryRun: true,
    sandboxOverrideIgnored: false,
  };

  let clientConfig;
  try {
    clientConfig = loadClientConfig(entry.clientId, { strict: true });
  } catch (err) {
    return {
      ...base,
      status: "skipped_not_found",
      durationMs: 0,
      errorMessage: err instanceof ClientConfigError ? err.message : String(err),
      seoOpportunities: null,
      contentProposals: null,
      competitorKeywordGaps: null,
      proposalsPreparedForReview: null,
      pendingApprovals: null,
      googleAdsConnected: null,
      ga4Connected: null,
      gtmConnected: null,
      wordpressDraftsEnabled: null,
      stagingHealthy: null,
      productionTouched: null,
      riskLines: [],
    };
  }

  const requestedDryRun = Boolean(entry.dryRun);
  const effectiveDryRun = clientConfig.isSandbox ? true : requestedDryRun;
  const sandboxOverrideIgnored = clientConfig.isSandbox && entry.dryRun === false;

  const args = ["ts-node", SINGLE_CLIENT_SCRIPT, "--client", entry.clientId];
  if (effectiveDryRun) {
    args.push("--dry-run");
  }

  console.log(`\n=== Cliente: ${entry.clientId} (isSandbox=${clientConfig.isSandbox}, dryRun=${effectiveDryRun}) ===`);
  if (sandboxOverrideIgnored) {
    console.log(
      `  Aviso: config/active-clients.json pedia dryRun:false para "${entry.clientId}", pero isSandbox:true lo ignora -- se ejecuta en dry-run de todas formas.`
    );
  }

  try {
    const output = execFileSync("npx", args, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 20 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    console.log(output.trim().split("\n").slice(-5).join("\n"));
    return {
      ...base,
      isSandbox: clientConfig.isSandbox,
      dryRun: effectiveDryRun,
      sandboxOverrideIgnored,
      status: "success",
      durationMs: Date.now() - startedAt,
      ...parseSingleClientOutput(output),
    };
  } catch (err: any) {
    const stdout = typeof err.stdout === "string" ? err.stdout : "";
    const stderr = typeof err.stderr === "string" ? err.stderr : "";
    const combined = `${stdout}\n${stderr}`;
    const errorMessage = (stderr || err.message || "error desconocido").trim().slice(-1500);
    console.log(`  FALLO: ${errorMessage}`);
    return {
      ...base,
      isSandbox: clientConfig.isSandbox,
      dryRun: effectiveDryRun,
      sandboxOverrideIgnored,
      status: "failed",
      durationMs: Date.now() - startedAt,
      errorMessage,
      ...parseSingleClientOutput(combined),
    };
  }
}

function fmt(value: boolean | number | null | undefined): string {
  if (value === null || value === undefined) return "n/d";
  return String(value);
}

function buildMultiClientSummaryMarkdown(dateLabel: string, results: ClientRunSummary[]): string {
  const lines: string[] = [];
  lines.push(`# Resumen multi-cliente — ${dateLabel}`, "");
  lines.push(
    "Generado por `npm run growth:daily:all` (Fase O16.3/O16.4). Cada cliente se ejecuto como proceso aislado -- un fallo en uno no detiene a los demas."
  );
  lines.push("");

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status.startsWith("skipped")).length;
  lines.push(`**${results.length} cliente(s)**: ${succeeded} OK, ${failed} fallo(s), ${skipped} omitido(s).`, "");

  for (const r of results) {
    lines.push(`## ${r.clientId}`, "");
    lines.push(`- Estado: **${r.status}**`);
    lines.push(`- Sandbox: ${fmt(r.isSandbox)}`);
    lines.push(`- Modo: ${r.dryRun ? "dry-run (cero red real)" : "real"}${r.sandboxOverrideIgnored ? " — aviso: dryRun:false pedido en active-clients.json fue IGNORADO por isSandbox:true" : ""}`);
    lines.push(`- Duracion: ${(r.durationMs / 1000).toFixed(1)}s`);
    if (r.status === "success" || r.status === "failed") {
      lines.push(`- Oportunidades SEO detectadas: ${fmt(r.seoOpportunities)}`);
      lines.push(`- Propuestas de contenido: ${fmt(r.contentProposals)}`);
      lines.push(`- Gaps de keyword de competencia: ${fmt(r.competitorKeywordGaps)}`);
      lines.push(`- Propuestas preparadas para revision: ${fmt(r.proposalsPreparedForReview)}`);
      lines.push(`- Aprobaciones pendientes: ${fmt(r.pendingApprovals)}`);
      lines.push(`- Google Ads conectado: ${fmt(r.googleAdsConnected)}`);
      lines.push(`- GA4 conectado: ${fmt(r.ga4Connected)}`);
      lines.push(`- GTM conectado: ${fmt(r.gtmConnected)}`);
      lines.push(`- WordPress drafts habilitado: ${fmt(r.wordpressDraftsEnabled)}`);
      lines.push(`- Staging saludable: ${fmt(r.stagingHealthy)}`);
      lines.push(`- Produccion tocada: ${fmt(r.productionTouched)}`);
      if (r.riskLines.length > 0) {
        lines.push(`- Lineas de riesgo/advertencia detectadas (primeras ${r.riskLines.length}):`);
        for (const line of r.riskLines) {
          lines.push(`  - \`${line.slice(0, 200)}\``);
        }
      }
    }
    if (r.errorMessage) {
      lines.push(`- Error: \`${r.errorMessage.slice(0, 500)}\``);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "Nota: para Zentry, el informe ejecutivo completo (lenguaje natural, sin IDs) sigue en `reports/daily/executive-<fecha>.md` y por email, exactamente igual que antes de esta fase -- este resumen es agregado/tecnico, no reemplaza a ese informe."
  );

  return lines.join("\n");
}

function main(): void {
  const entries = loadActiveClients();
  const results: ClientRunSummary[] = [];

  for (const entry of entries) {
    if (entry.enabled === false) {
      console.log(`\n=== Cliente: ${entry.clientId} (enabled:false, omitido) ===`);
      results.push({
        clientId: entry.clientId,
        status: "skipped_disabled",
        isSandbox: null,
        dryRun: true,
        sandboxOverrideIgnored: false,
        durationMs: 0,
        seoOpportunities: null,
        contentProposals: null,
        competitorKeywordGaps: null,
        proposalsPreparedForReview: null,
        pendingApprovals: null,
        googleAdsConnected: null,
        ga4Connected: null,
        gtmConnected: null,
        wordpressDraftsEnabled: null,
        stagingHealthy: null,
        productionTouched: null,
        riskLines: [],
      });
      continue;
    }
    results.push(runSingleClient(entry));
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(MULTI_CLIENT_REPORTS_DIR)) {
    fs.mkdirSync(MULTI_CLIENT_REPORTS_DIR, { recursive: true });
  }
  const summaryPath = path.join(MULTI_CLIENT_REPORTS_DIR, `daily-summary-${dateLabel}.md`);
  fs.writeFileSync(summaryPath, buildMultiClientSummaryMarkdown(dateLabel, results), "utf-8");

  console.log("\n=== Resumen multi-cliente ===");
  for (const r of results) {
    console.log(`  ${r.clientId}: ${r.status}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ""}`);
  }
  console.log(`\nResumen escrito en: ${summaryPath}`);

  const anyFailed = results.some((r) => r.status === "failed");
  process.exit(anyFailed ? 1 : 0);
}

main();
