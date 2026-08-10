import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import {
  createProductionDraftPage,
  getProductionPage,
  getProductionStatusForReport,
} from "../src/adapters/wordpress-production";

/**
 * O21.5b Etapa H -- crea la landing /bancos-de-vestuario/ en produccion
 * como DRAFT (createProductionDraftPage() siempre fuerza status:draft,
 * nunca publica). No toca menu, enlaces internos, taquillas, cerraduras
 * ni productos (solo lectura de sus slugs/IDs ya creados). Contenido
 * leido EN VIVO de staging (pagina 2048) y remapeado: IDs de media via
 * data/o21e-media-mapping-*.json, dominio staging -> produccion en
 * TODAS las URLs (imagenes y enlaces).
 *
 * Uso:
 *   npx ts-node scripts/o21h-create-bancos-landing.ts                                     (dry-run: solo transforma y valida, no escribe)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true npx ts-node scripts/o21h-create-bancos-landing.ts --confirm
 */

const STAGING_BASE = "https://staging.zentrylockers.com";
const STAGING_LANDING_PAGE_ID = 2048;
const MEDIA_MAPPING_PATH = "data/o21e-media-mapping-1786132769365.json";
const PRODUCTION_SLUG = "bancos-de-vestuario";

interface StagingConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}
function resolveStagingConfig(): StagingConfig {
  const activeClientId = resolveActiveClientId();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_APP_PASSWORD");
  return { baseUrl: STAGING_BASE, username, appPassword };
}
function stagingAuthHeader(config: StagingConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}
async function stagingGet<T>(path: string): Promise<T> {
  const config = resolveStagingConfig();
  const res = await fetch(`${config.baseUrl}${path}`, { headers: { Authorization: stagingAuthHeader(config) } });
  if (!res.ok) throw new Error(`GET staging ${path} respondio ${res.status}`);
  return (await res.json()) as T;
}

interface MediaMappingEntry {
  stagingMediaId: number;
  productionMediaId: number | null;
}

interface StagingPage {
  id: number;
  slug: string;
  title: { raw: string };
  excerpt: { raw: string };
  content: { raw: string };
}

function remapContent(rawContent: string, mediaMap: Map<number, number | null>): { content: string; mediaIdsUsed: number[] } {
  let content = rawContent;
  const mediaIdsUsed: number[] = [];

  for (const [stagingId, productionId] of mediaMap.entries()) {
    if (productionId === null) continue;
    const idPattern = new RegExp(`"id":${stagingId}([,}])`, "g");
    const classPattern = new RegExp(`wp-image-${stagingId}\b`, "g");
    const before = content;
    content = content.replace(idPattern, `"id":${productionId}`);
    content = content.replace(classPattern, `wp-image-${productionId}`);
    if (content !== before) mediaIdsUsed.push(stagingId);
  }

  content = content.split("staging.zentrylockers.com").join("zentrylockers.com");

  return { content, mediaIdsUsed };
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const status = getProductionStatusForReport();
  console.log("wordpress-production canWrite:", status.canWrite, "| targetUrl:", status.targetUrl);

  const stagingPage = await stagingGet<StagingPage>(`/wp-json/wp/v2/pages/${STAGING_LANDING_PAGE_ID}?context=edit`);
  console.log(`Staging landing: id ${stagingPage.id}, slug ${stagingPage.slug}, contenido ${stagingPage.content.raw.length} caracteres`);
  if (stagingPage.slug !== PRODUCTION_SLUG) {
    throw new Error(`Slug de staging (${stagingPage.slug}) no coincide con el esperado (${PRODUCTION_SLUG}). Bloqueado.`);
  }

  const mediaMapping: MediaMappingEntry[] = JSON.parse(fs.readFileSync(MEDIA_MAPPING_PATH, "utf-8"));
  const mediaMap = new Map(mediaMapping.map((m) => [m.stagingMediaId, m.productionMediaId]));

  const { content, mediaIdsUsed } = remapContent(stagingPage.content.raw, mediaMap);

  const remainingStagingRefs = (content.match(/staging\.zentrylockers\.com/g) || []).length;
  console.log(`Media IDs remapeados (staging -> produccion): ${mediaIdsUsed.length}`, mediaIdsUsed.map((id) => `${id}->${mediaMap.get(id)}`).join(", "));
  console.log(`Referencias a staging.zentrylockers.com restantes en el contenido: ${remainingStagingRefs} (esperado 0)`);
  if (remainingStagingRefs > 0) {
    throw new Error("Quedan referencias a staging en el contenido remapeado. Bloqueado -- no se crea nada.");
  }

  // \"backup\": snapshot de si ya existe una pagina con este slug en produccion, ANTES de crear nada.
  const existingCheck = await fetch(`${status.targetUrl}/wp-json/wp/v2/pages?slug=${PRODUCTION_SLUG}&_cb=${Date.now()}`).then((r) => r.json()) as Array<{ id: number; status: string }>;
  const backupPath = `data/o21h-landing-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify({ generatedAt: new Date().toISOString(), existingProductionPagesWithSlug: existingCheck, stagingSourcePageId: STAGING_LANDING_PAGE_ID, remappedContent: content, remappedTitle: stagingPage.title.raw, remappedExcerpt: stagingPage.excerpt.raw }, null, 2));
  console.log(`Backup/snapshot escrito: ${backupPath} (paginas produccion existentes con este slug: ${existingCheck.length}, esperado 0)`);
  if (existingCheck.length > 0) {
    throw new Error(`Ya existe una pagina en produccion con slug \"${PRODUCTION_SLUG}\" (id ${existingCheck[0].id}, status ${existingCheck[0].status}). Bloqueado -- no se crea un duplicado.`);
  }

  if (!confirm) {
    console.log("\nDry-run completo -- contenido validado (sin URLs de staging, media remapeada, sin duplicados). Repite con --confirm (+ flags inline) para crear el draft de verdad.");
    return;
  }

  const created = await createProductionDraftPage({
    title: stagingPage.title.raw,
    contentHtml: content,
    excerpt: stagingPage.excerpt.raw,
    slug: PRODUCTION_SLUG,
  });
  console.log("\n=== Draft creado ===");
  console.log(JSON.stringify(created, null, 2));

  const verify = await getProductionPage(created.wordpressPageId);
  console.log("\n=== Verificacion post-creacion ===");
  console.log("status:", verify.status, "(esperado draft)");
  console.log("slug:", verify.slug, "(esperado", PRODUCTION_SLUG, ")");

  const outPath = `data/o21h-landing-created-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ created, verify: { id: verify.id, status: verify.status, slug: verify.slug, link: verify.link } }, null, 2));
  console.log(`\nGuardado en: ${outPath}`);

  console.log("\n=== Rollback (si hace falta) ===");
  console.log(`npx ts-node scripts/o215-rollback-landing.ts --pageId ${verify.id} --confirm`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
