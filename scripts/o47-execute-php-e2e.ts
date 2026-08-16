/**
 * O47 -- E2E REAL del fallback `execute-php` sobre STAGING.
 *
 * Ejecuta, contra el sitio de verdad, el flujo completo que autoriza el
 * diseño:
 *
 *   get-content -> BEFORE + hash -> ChangePlan -> demostrar que NO hay
 *   ability nativa -> execute_php_fallback -> guard -> PHP limitado ->
 *   read-back -> validar AFTER -> revertir -> read-back final ->
 *   comprobar que quedo EXACTAMENTE igual que al principio.
 *
 * Dos modos, y el de listar existe para no tener que adivinar una pagina:
 *
 *   --mode list                 Solo lectura. Lista paginas candidatas de
 *                               staging (id, status, slug, titulo) para
 *                               que una persona elija. Cero escrituras.
 *   --mode run --postId <N>     El E2E completo sobre esa pagina.
 *
 * ESCRITURAS: dos en STAGING (el cambio y su reversion), cero en
 * produccion. Este script no tiene ninguna via para tocar produccion: el
 * guard bloquea `production` de forma incondicional y el executor solo
 * conoce staging.
 *
 * LECTURAS: por REST del core de WordPress con las credenciales
 * `WP_API_*` (las mismas que ya usa el probe de Novamira, y que el probe
 * demostro validas). Leer por REST y escribir por MCP es deliberado: la
 * validacion posterior se hace por un camino DISTINTO al de la escritura,
 * asi que no puede "confirmarse a si misma".
 */
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { appendExecutePhpAudit } from "../src/core/execute-php-audit";
import {
  EXECUTE_PHP_CONTRACT_VERSION,
  ExecutePhpChangePlan,
  NATIVE_ABILITY_FOR_OPERATION,
  selectExecutionPath,
} from "../src/core/execute-php-operations";
import { assertToolCallAllowed, callNovamiraExecutePhp, openSession } from "../src/adapters/novamira-mcp-client";
import { callMcpTool, extractTextContent } from "../src/adapters/novamira-mcp-transport";
import { NovamiraSession } from "../src/adapters/novamira-mcp-transport";
import { resolveNovamiraCredentials } from "../src/adapters/novamira-mcp-transport";
import { applyChangePlanWithPhp, ExecutePhpContext, PhpTargetState } from "../src/department/apply/execute-php-executor";
import { assessNativeAbilityForPlan } from "../src/core/novamira-ability-capabilities";
import { parseBlockInventory } from "../src/core/gutenberg-blocks";
import { computeVersionHash } from "../src/department/apply/version";

const PROJECT_ROOT = path.join(__dirname, "..");
const REPORT_DIR = path.join(PROJECT_ROOT, "reports", "execute-php-e2e");

/** Operacion del E2E: `post_content` con un H2 (`core/heading`). Ver `chooseOperation()`. */
const E2E_OPERATION = "update_post_content" as const;

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

function isEnabled(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

/** Base del REST del core, derivada de WP_API_URL sin exponer su valor. */
function resolveCoreRestBase(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  const withoutMcp = trimmed.replace(/\/wp-json\/mcp\/.*$/, "");
  return `${withoutMcp}/wp-json/wp/v2`;
}

function authHeaderFor(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

interface RestPage {
  id: number;
  status: string;
  slug: string;
  link: string;
  title: { raw?: string; rendered?: string };
  content: { raw?: string; rendered?: string };
  excerpt: { raw?: string; rendered?: string };
  meta?: Record<string, unknown>;
}

async function restGet<T>(url: string, authHeader: string): Promise<T> {
  const response = await fetch(url, { method: "GET", headers: { Authorization: authHeader } });
  if (!response.ok) {
    // Nunca se propaga el cuerpo crudo: podria traer datos del sitio.
    throw new Error(`El REST del core respondio HTTP ${response.status} al leer ${url.replace(/https?:\/\/[^/]+/, "(host)")}.`);
  }
  return (await response.json()) as T;
}

/** Lee el estado real de la pagina. Es el `getState` que consume el executor. */
function buildStateReader(restBase: string, authHeader: string): (postId: number) => Promise<PhpTargetState> {
  return async (postId: number) => {
    const page = await restGet<RestPage>(`${restBase}/pages/${postId}?context=edit`, authHeader);
    return {
      id: page.id,
      status: page.status,
      title: page.title?.raw ?? page.title?.rendered ?? "",
      contentHtml: page.content?.raw ?? page.content?.rendered ?? "",
      excerpt: page.excerpt?.raw ?? page.excerpt?.rendered ?? "",
      link: page.link,
      slug: page.slug,
      // Esta operacion no toca post meta; el mapa va vacio a proposito en
      // vez de rellenarse con datos que no se han leido de verdad.
      meta: {},
    };
  };
}

async function listCandidates(restBase: string, authHeader: string): Promise<void> {
  const pages = await restGet<RestPage[]>(`${restBase}/pages?per_page=50&status=publish&context=edit&orderby=modified&order=desc`, authHeader);
  console.log(`Paginas PUBLICADAS en staging (${pages.length}). Elige una NO critica para el E2E:\n`);
  for (const page of pages) {
    const contentHtml = page.content?.raw ?? "";
    const inventory = parseBlockInventory(contentHtml);
    const hasH2 = /<!--\s*wp:heading[\s\S]*?-->\s*<h2\b/i.test(contentHtml);
    console.log(`  id=${String(page.id).padEnd(6)} slug=${page.slug}`);
    console.log(`         titulo:   ${(page.title?.raw ?? "").slice(0, 80)}`);
    console.log(`         bloques:  ${inventory.isClassicContent ? "(contenido clasico, sin bloques)" : inventory.blockTypes.join(", ").slice(0, 140)}`);
    console.log(`         H2 nativo: ${hasH2 ? "SI" : "no"}`);
  }
  console.log("\nCero escrituras. Este modo solo lee.");
}

/**
 * Por que el E2E cambia un H2 y por que ese H2 va por PHP.
 *
 * Un H2 vive en `post_content`, y `post_content` SI tiene ability nativa
 * declarada: `novamira/gutenberg-write-content`. Pero la existencia
 * NOMINAL no basta. El servidor dice de esa ability, textualmente:
 *
 *   "Directly writes Gutenberg post_content ONLY when every supplied
 *    block is a registered Novamira-owned dynamic-only block. [...] For
 *    static/native blocks, this ability REFUSES the write."
 *
 * Un `core/heading` es un bloque nativo/estatico, asi que la nativa lo
 * rechazaria. `selectExecutionPath()` lo deriva del propio contenido
 * (tipos de bloque reales) y devuelve `execute_php_fallback` con un
 * motivo verificable -- nadie tiene que declararlo a mano.
 */
function chooseOperation(): { operation: typeof E2E_OPERATION; nativeAbility: string | null } {
  return { operation: E2E_OPERATION, nativeAbility: NATIVE_ABILITY_FOR_OPERATION[E2E_OPERATION] };
}

/**
 * Cambia el texto del PRIMER `core/heading` de nivel 2, dejando intacto
 * todo lo demas del cuerpo. Devuelve `null` si la pagina no tiene ningun
 * H2: el E2E se detiene en vez de inventarse un cambio.
 */
export function replaceFirstH2Text(contentHtml: string, newText: string): { html: string; previousText: string } | null {
  // Bloque heading de Gutenberg: su delimitador va seguido de un <h2>.
  const pattern = /(<!--\s*wp:heading[\s\S]*?-->\s*<h2\b[^>]*>)([\s\S]*?)(<\/h2>)/i;
  const match = contentHtml.match(pattern);
  if (!match) return null;
  return {
    previousText: match[2],
    html: contentHtml.replace(pattern, `$1${newText}$3`),
  };
}

function planFor(postId: number, expectedBeforeHash: string, value: string): ExecutePhpChangePlan {
  return {
    contractVersion: EXECUTE_PHP_CONTRACT_VERSION,
    operation: E2E_OPERATION,
    targetId: postId,
    expectedBeforeHash,
    payload: { value },
    scopeFields: ["post_content"],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? "list";

  const credentials = resolveNovamiraCredentials();
  const restBase = resolveCoreRestBase(credentials.url);
  const authHeader = authHeaderFor(credentials.username, credentials.password);

  if (mode === "list") {
    await listCandidates(restBase, authHeader);
    return;
  }

  // Introspeccion SOLO LECTURA: pregunta al servidor que parametros
  // declara una ability, en vez de adivinarlos. Adivinar el nombre del
  // parametro fue exactamente lo que hizo que el primer intento de E2E no
  // escribiera nada.
  if (mode === "ability-info") {
    const requested = args.ability && args.ability !== "true" ? args.ability : "novamira/execute-php";
    const session = await openSession();
    const tool = "mcp-adapter-get-ability-info";
    // Pasa por el guard como cualquier otra llamada: es un tool safe_read.
    assertToolCallAllowed("web_engineer_staging_write", tool, {});
    for (const ability of requested.split(",").map((name) => name.trim()).filter(Boolean)) {
      const body = await callMcpTool(session, tool, { ability_name: ability });
      console.log(`\n===== ESQUEMA REAL DE "${ability}" =====`);
      console.log(extractTextContent(body).slice(0, 8000));
    }
    console.log("\nCero escrituras. Este modo solo lee metadatos.");
    return;
  }
  if (mode !== "run") throw new Error(`--mode "${mode}" desconocido. Usa "list", "ability-info" o "run".`);

  const postId = Number(args.postId);
  if (!Number.isInteger(postId) || postId <= 0) throw new Error("Falta --postId <N> (entero positivo).");

  const wordpressEnv = (process.env.WORDPRESS_ENV ?? "").trim().toLowerCase();
  if (wordpressEnv !== "staging") {
    throw new Error(`WORDPRESS_ENV="${wordpressEnv}" no es "staging". Fail-closed: este E2E solo corre contra staging.`);
  }

  const getState = buildStateReader(restBase, authHeader);
  let session: NovamiraSession | null = null;

  const steps: Record<string, unknown>[] = [];
  const log = (step: string, data: Record<string, unknown>): void => {
    steps.push({ step, ...data });
    console.log(`\n[${step}] ${JSON.stringify(data)}`);
  };

  // --- 1. get-content + BEFORE + hash ---
  const before = await getState(postId);
  const beforeHash = computeVersionHash({ status: before.status, title: before.title, metaDescription: before.excerpt, contentHtml: before.contentHtml });
  log("1-before", {
    postId: before.id,
    status: before.status,
    slug: before.slug,
    url: before.link,
    h2Before: (before.contentHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ?? [])[1] ?? "(sin h2)",
    versionHash: beforeHash,
  });

  if (before.status !== "publish") {
    throw new Error(`La pagina ${postId} tiene status "${before.status}". El E2E solo actua sobre una pagina publicada en staging.`);
  }

  // --- 2/3. ChangePlan + demostrar que no hay ability nativa ---
  const { nativeAbility } = chooseOperation();

  const marker = `[E2E execute-php ${new Date().toISOString()}]`;
  const edited = replaceFirstH2Text(before.contentHtml, `Configurador de bancos ${marker}`);
  if (!edited) {
    throw new Error(`La pagina ${postId} no tiene ningun bloque core/heading de nivel 2. El E2E se detiene: no se inventa un cambio.`);
  }
  const plan = planFor(postId, beforeHash, edited.html);

  // La seleccion se deriva del PLAN (tipos de bloque reales), no de la
  // operacion a secas.
  const selection = selectExecutionPath({ plan });
  const support = assessNativeAbilityForPlan(plan);
  log("2-capability", {
    operation: E2E_OPERATION,
    nativeAbilityForOperation: nativeAbility,
    blockTypesInContent: support?.blockTypes ?? [],
    unsupportedByNative: support?.unsupportedBlockTypes ?? [],
    executionPath: selection.executionPath,
    reason: selection.reason,
  });
  if (selection.executionPath !== "execute_php_fallback") {
    throw new Error("La seleccion de capacidad NO eligio el fallback de PHP. El E2E se detiene: no se fuerza el camino de PHP.");
  }

  const context: ExecutePhpContext = {
    departmentRunId: args.departmentRunId && args.departmentRunId !== "true" ? args.departmentRunId : "o47-execute-php-e2e",
    recommendationId: "o47#e2e-rec-1",
    changeId: `o47#e2e-change-${postId}`,
    qaStatus: "PASS",
    capabilitySelection: selection,
    flags: {
      executePhpFallbackEnabled: isEnabled("NOVAMIRA_EXECUTE_PHP_FALLBACK_ENABLED"),
      novamiraStagingWritesEnabled: isEnabled("NOVAMIRA_STAGING_WRITES_ENABLED"),
      wordpressEnv,
    },
  };

  session = await openSession();
  const deps = {
    getState,
    runPhp: async (php: string): Promise<string> => {
      return callNovamiraExecutePhp(
        {
          actor: "web_engineer_apply",
          abilityName: "novamira/execute-php",
          environment: "staging",
          // El E2E solo emite escrituras de apply: la reversion es otro
          // ChangePlan normal, tambien en fase "apply". El rollback
          // automatico del executor construye su propia peticion.
          phase: "apply",
          qaStatus: context.qaStatus,
          departmentRunId: context.departmentRunId,
          recommendationId: context.recommendationId,
          changeId: context.changeId,
          plan,
          php,
          capabilitySelection: selection,
          flags: context.flags,
          snapshotPreviousValue: before.contentHtml,
          snapshotPreviousExisted: true,
        },
        session ?? undefined
      );
    },
  };

  // --- 4/5/6/7. guard + ejecutar + read-back + validar ---
  const applyOutcome = await applyChangePlanWithPhp(plan, context, deps);
  for (const record of applyOutcome.audit) appendExecutePhpAudit(record);
  log("3-apply", {
    status: applyOutcome.status,
    stagingWritePerformed: applyOutcome.stagingWritePerformed,
    productionWritePerformed: applyOutcome.productionWritePerformed,
    validation: applyOutcome.validation,
    beforeValue: applyOutcome.beforeValue,
    afterValue: applyOutcome.afterValue,
    detail: applyOutcome.detail,
  });

  if (applyOutcome.status !== "applied") {
    // Ya se habra revertido solo si llego a escribir. Se reporta y se
    // acaba en rojo: el E2E no se "arregla" relajando nada.
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `e2e-${postId}.json`), JSON.stringify({ postId, steps, outcome: applyOutcome.status }, null, 2), "utf-8");
    throw new Error(`El apply no termino en "applied" sino en "${applyOutcome.status}". ${applyOutcome.detail}`);
  }

  // --- 8. Estado intermedio real, leido otra vez ---
  const middle = await getState(postId);
  log("4-after", {
    h2After: (middle.contentHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ?? [])[1] ?? "(sin h2)",
    versionHash: computeVersionHash({ status: middle.status, title: middle.title, metaDescription: middle.excerpt, contentHtml: middle.contentHtml }),
  });

  // --- 9/10. REVERTIR: es otro ChangePlan normal, por el mismo guard ---
  const middleHash = computeVersionHash({ status: middle.status, title: middle.title, metaDescription: middle.excerpt, contentHtml: middle.contentHtml });
  const revertPlan = planFor(postId, middleHash, before.contentHtml);
  const revertContext: ExecutePhpContext = { ...context, changeId: `${context.changeId}-revert` };
  const revertDeps = {
    getState,
    runPhp: async (php: string): Promise<string> => {
      return callNovamiraExecutePhp(
        {
          actor: "web_engineer_apply",
          abilityName: "novamira/execute-php",
          environment: "staging",
          phase: "apply",
          qaStatus: revertContext.qaStatus,
          departmentRunId: revertContext.departmentRunId,
          recommendationId: revertContext.recommendationId,
          changeId: revertContext.changeId,
          plan: revertPlan,
          php,
          capabilitySelection: selection,
          flags: revertContext.flags,
          snapshotPreviousValue: middle.contentHtml,
          snapshotPreviousExisted: true,
        },
        session ?? undefined
      );
    },
  };
  const revertOutcome = await applyChangePlanWithPhp(revertPlan, revertContext, revertDeps);
  for (const record of revertOutcome.audit) appendExecutePhpAudit(record);
  log("5-revert", { status: revertOutcome.status, validation: revertOutcome.validation, detail: revertOutcome.detail });

  // --- 11/12. read-back final y comprobacion de identidad exacta ---
  const final = await getState(postId);
  const finalHash = computeVersionHash({ status: final.status, title: final.title, metaDescription: final.excerpt, contentHtml: final.contentHtml });
  const identical = finalHash === beforeHash && final.contentHtml === before.contentHtml;
  log("6-final", {
    h2Final: (final.contentHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ?? [])[1] ?? "(sin h2)",
    versionHash: finalHash,
    identicalToStart: identical,
  });

  const stagingWrites = (applyOutcome.stagingWritePerformed ? 1 : 0) + (revertOutcome.stagingWritePerformed ? 1 : 0);
  const summary = {
    postId,
    url: before.link,
    operation: E2E_OPERATION,
    executionPath: selection.executionPath,
    nativeAbilityForOperation: nativeAbility,
    h2Before: edited.previousText,
    h2Temporary: `Configurador de bancos ${marker}`,
    blockTypesInContent: support?.blockTypes ?? [],
    unsupportedByNativeAbility: support?.unsupportedBlockTypes ?? [],
    beforeHash,
    middleHash,
    finalHash,
    identicalToStart: identical,
    stagingWrites,
    productionWrites: 0,
    steps,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `e2e-${postId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nInforme del E2E en ${path.relative(PROJECT_ROOT, reportPath)}.`);
  console.log(`E2E_RESULT_JSON=${JSON.stringify({ postId, identicalToStart: identical, stagingWrites, productionWrites: 0 })}`);

  if (!identical) {
    throw new Error("La pagina NO quedo exactamente igual que al inicio tras revertir. Requiere revision humana.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
