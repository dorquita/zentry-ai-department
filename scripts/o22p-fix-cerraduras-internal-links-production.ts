import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import {
  resolveProductionTargetUrl,
  canAttemptProductionWrites,
  getProductionPage,
  updateProductionPublishedPageContent,
} from "../src/adapters/wordpress-production";

/**
 * Ajuste O22 -- corrige TODAS las referencias internas encontradas por
 * o22o-scan-cerraduras-references-production.ts (15 elementos, 18
 * ocurrencias: 13 paginas + 2 entradas de blog). Reemplazo QUIRURGICO:
 * SOLO sustituye `href="https://zentrylockers.com/cerraduras/"` por
 * `href="https://zentrylockers.com/cerraduras-para-taquillas/"` en el
 * contenido -- no toca texto de enlace, no toca ningun otro parrafo o
 * bloque, no cambia titulo/slug/status. Paginas via
 * updateProductionPublishedPageContent() (ya existente, exige status
 * "publish" verificado, nunca cambia status/slug). Entradas de blog
 * (posts) via el mismo patron pero con fetch directo porque el adapter
 * compartido todavia no cubre `wp/v2/posts` -- mismo gate
 * (canAttemptProductionWrites()), mismo POST-solo-si-status-actual-es-publish,
 * mismo "nunca cambia status/slug".
 *
 * Backup COMPLETO (contenido raw integro) de cada elemento ANTES de
 * escribir, guardado en data/. Dry-run por defecto: muestra cuantas
 * ocurrencias se sustituirian por elemento sin escribir nada.
 *
 * Uso:
 *   npx ts-node scripts/o22p-fix-cerraduras-internal-links-production.ts                      (dry-run)
 *   PRODUCTION_EXECUTION_ENABLED=true PRODUCTION_DRAFTS_ENABLED=true PRODUCTION_BACKEND=rest npx ts-node scripts/o22p-fix-cerraduras-internal-links-production.ts --confirm
 */

const OLD_HREF = 'href="https://zentrylockers.com/cerraduras/"';
const NEW_HREF = 'href="https://zentrylockers.com/cerraduras-para-taquillas/"';

const PAGES_TO_FIX = [1865, 1862, 1823, 1822, 1821, 1820, 133, 131, 129, 127, 124, 100, 24];
const POSTS_TO_FIX = [1915, 1912];

interface WpConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}
function resolveConfig(): WpConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}
function authHeaderFor(config: WpConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

interface PostInfo {
  id: number;
  status: string;
  title: string;
  contentRaw: string;
  slug: string;
}

async function getProductionPost(config: WpConfig, postId: number): Promise<PostInfo> {
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit&_cb=${Date.now()}`, {
    headers: { Authorization: authHeader, "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`GET post ${postId} respondio ${res.status}`);
  const j = (await res.json()) as { id: number; status: string; title: { raw?: string }; content: { raw?: string }; slug: string };
  return { id: j.id, status: j.status, title: j.title.raw ?? "", contentRaw: j.content.raw ?? "", slug: j.slug };
}

async function updateProductionPost(config: WpConfig, postId: number, title: string, contentHtml: string): Promise<void> {
  const authHeader = authHeaderFor(config);
  const res = await fetch(`${config.baseUrl}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ title, content: contentHtml, status: "publish" }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`POST post ${postId} respondio ${res.status}: ${bodyText.slice(0, 300)}`);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const config = resolveConfig();

  console.log("=== Ajuste O22: corregir enlaces internos a /cerraduras/ (produccion) ===");
  console.log(`canWrite (3 condiciones): ${canAttemptProductionWrites()}`);

  const backups: Array<Record<string, unknown>> = [];
  const plan: Array<{ type: "page" | "post"; id: number; title: string; occurrences: number }> = [];

  for (const id of PAGES_TO_FIX) {
    const p = await getProductionPage(id);
    const occ = countOccurrences(p.contentHtml, OLD_HREF);
    backups.push({ type: "page", id, status: p.status, slug: p.slug, title: p.title, excerpt: p.excerpt, contentHtml: p.contentHtml });
    plan.push({ type: "page", id, title: p.title, occurrences: occ });
  }
  for (const id of POSTS_TO_FIX) {
    const p = await getProductionPost(config, id);
    const occ = countOccurrences(p.contentRaw, OLD_HREF);
    backups.push({ type: "post", id, status: p.status, slug: p.slug, title: p.title, contentHtml: p.contentRaw });
    plan.push({ type: "post", id, title: p.title, occurrences: occ });
  }

  const backupPath = `data/o22p-links-backup-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(backups, null, 2));
  console.log(`Backup completo (contenido integro de los ${backups.length} elementos) escrito: ${backupPath}`);

  console.log("\n=== Plan ===");
  let totalOcc = 0;
  for (const p of plan) {
    console.log(`  [${p.type}] id ${p.id} "${p.title}" -- ${p.occurrences} ocurrencia(s) a sustituir`);
    totalOcc += p.occurrences;
  }
  console.log(`Total: ${totalOcc} ocurrencias en ${plan.length} elementos.`);

  if (!confirm) {
    console.log("\nSIMULACION: falta --confirm. No se ha escrito nada.");
    return;
  }
  if (!canAttemptProductionWrites()) {
    console.error("Bloqueado: faltan las 3 condiciones de produccion.");
    process.exit(1);
    return;
  }

  console.log("\n=== ESCRITURA REAL ===");
  const doneIds: Array<{ type: string; id: number }> = [];
  for (const b of backups) {
    const type = b.type as "page" | "post";
    const id = b.id as number;
    const title = b.title as string;
    const contentHtml = b.contentHtml as string;
    const newContent = contentHtml.split(OLD_HREF).join(NEW_HREF);
    if (newContent === contentHtml) {
      console.log(`  [${type}] id ${id}: sin cambios (0 ocurrencias), se omite.`);
      continue;
    }
    if (type === "page") {
      await updateProductionPublishedPageContent({ pageId: id, title, contentHtml: newContent });
    } else {
      await updateProductionPost(config, id, title, newContent);
    }
    console.log(`  [${type}] id ${id}: actualizado.`);
    doneIds.push({ type, id });
  }

  console.log(`\n=== Completado: ${doneIds.length} elementos actualizados ===`);
  console.log(JSON.stringify(doneIds));
  console.log(`\nRollback: restaurar contentHtml/title de cada elemento desde ${backupPath} (via updateProductionPublishedPageContent()/POST directo a wp/v2/posts).`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
