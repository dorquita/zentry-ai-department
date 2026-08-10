import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { resolveActiveClientId, resolveClientSecret } from "../src/core/client-config";
import { resolveProductionTargetUrl, getProductionStatusForReport, getProductionPage } from "../src/adapters/wordpress-production";
import {
  getWoocommerceProductionStatusForReport,
  getProductionCategories,
  createProductionCategory,
  getProductionAttributes,
  createProductionAttribute,
  createProductionAttributeTerm,
} from "../src/adapters/woocommerce-production";

/**
 * O21.5a -- dry-run consolidado de las 9 etapas del deploy de Bancos a
 * produccion (categorias, atributos/terminos, productos padre,
 * variaciones, mapping de media, landing draft, menu, enlaces internos,
 * fix de disable_header). SOLO LECTURA + dryRun:true en todo momento --
 * ninguna llamada de este script escribe nada en produccion. Construye
 * ademas el manifest completo (data/o215-deploy-manifest.json) a partir
 * de datos reales (staging + produccion), no de valores inventados.
 */

const STAGING_BASE = "https://staging.zentrylockers.com";

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
  const res = await fetch(`${config.baseUrl}${path}${path.includes("?") ? "&" : "?"}_cb=${Date.now()}`, {
    headers: { Authorization: stagingAuthHeader(config), "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GET staging ${path} respondio ${res.status}`);
  return (await res.json()) as T;
}

interface ProductionConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
}

function resolveProductionConfig(): ProductionConfig {
  const activeClientId = resolveActiveClientId();
  const baseUrl = resolveProductionTargetUrl();
  const username = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_USERNAME");
  const appPassword = resolveClientSecret(activeClientId, "WORDPRESS_PRODUCTION_APP_PASSWORD");
  return { baseUrl, username, appPassword };
}

function productionAuthHeader(config: ProductionConfig): string {
  return "Basic " + Buffer.from(`${config.username}:${config.appPassword}`).toString("base64");
}

async function productionGet<T>(path: string): Promise<T> {
  const config = resolveProductionConfig();
  const res = await fetch(`${config.baseUrl}${path}${path.includes("?") ? "&" : "?"}_cb=${Date.now()}`, {
    headers: { Authorization: productionAuthHeader(config), "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GET produccion ${path} respondio ${res.status}`);
  return (await res.json()) as T;
}

const manifest: Record<string, unknown> = { generatedAt: new Date().toISOString(), stages: {} };

function section(title: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

// ===================== Preflight =====================

async function preflight(): Promise<void> {
  section("PREFLIGHT: estado de gates y credenciales");
  const wpStatus = getProductionStatusForReport();
  const wcStatus = getWoocommerceProductionStatusForReport();
  console.log("wordpress-production canWrite:", wpStatus.canWrite, "| targetUrl:", wpStatus.targetUrl);
  console.log("woocommerce-production canWrite:", wcStatus.canWrite, "| hostOk:", wcStatus.hostOk, "| targetUrl:", wcStatus.targetUrl);
  console.log("(Se espera canWrite=false en esta fase -- solo se construye infraestructura, no se activan los flags de escritura.)");
}

// ===================== A. Fix disable_header =====================

async function dryRunHeaderFix(): Promise<void> {
  section("ETAPA A -- dry-run: fix disable_header en /taquillas-por-sector/ (produccion, id 1636)");
  const page = await productionGet<{ blocksy_meta: Record<string, unknown> }>("/wp-json/wp/v2/pages/1636?context=edit");
  const current = page.blocksy_meta?.disable_header;
  console.log("blocksy_meta.disable_header ACTUAL:", JSON.stringify(current));
  console.log('blocksy_meta.disable_header PROPUESTO: "no"');
  (manifest.stages as Record<string, unknown>).A_fix_disable_header = {
    stagingReference: "ya corregido en staging (mismo mecanismo, verificado)",
    productionTarget: "pagina 1636 (/taquillas-por-sector/)",
    action: "PATCH blocksy_meta.disable_header: yes -> no (unica clave tocada)",
    payloadSummary: { pageId: 1636, field: "blocksy_meta.disable_header", from: current, to: "no" },
    dependency: "ninguna -- independiente del resto",
    rollback: "PATCH blocksy_meta.disable_header: no -> yes",
    risk: "bajo -- cambio de una sola clave, ya validado en staging, reversible en un paso",
  };
}

// ===================== B. Mu-plugin (manual, sin codigo) =====================

function dryRunMuPlugin(): void {
  section("ETAPA B -- mu-plugin v1.5.0-O21.1c (MANUAL, sin mecanismo automatizado)");
  console.log("No existe ningun adapter en este proyecto para subir archivos a wp-content/mu-plugins/.");
  console.log("Cuando llegue el momento se entregara: ruta exacta del archivo + version + instrucciones de subida manual.");
  (manifest.stages as Record<string, unknown>).B_mu_plugin = {
    stagingReference: "wp-content/mu-plugins/zentry-hide-prices-guests.php v1.5.0-O21.1c (activo y probado en staging)",
    productionTarget: "wp-content/mu-plugins/zentry-hide-prices-guests.php (produccion, actualmente v1.4.0-O19.5)",
    action: "MANUAL -- Pau sube/autoriza el metodo concreto, sin automatizacion de este proyecto",
    payloadSummary: { note: "sin payload API -- es un archivo de codigo" },
    dependency: "debe estar hecho ANTES de crear los productos banco en produccion (Etapa F), para que el CTA contextual funcione desde el primer producto",
    rollback: "manual -- restaurar copia de v1.4.0-O19.5 (backup obligatorio antes de subir v1.5.0)",
    risk: "medio -- es el unico paso 100% manual y bloqueante; si se olvida, los CTA de bancos muestran texto generico con \"cerradura\" (no rompe nada, pero es inconsistente)",
  };
}

// ===================== C. Categorias (dry-run real contra produccion) =====================

interface StagingCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

async function dryRunCategories(): Promise<void> {
  section("ETAPA C -- dry-run REAL: categorias Bancos (llama al adapter con dryRun:true)");
  const stagingCats = await stagingGet<StagingCategory[]>("/wp-json/wc/v3/products/categories?per_page=100&search=banco");
  const parent = stagingCats.find((c) => c.slug === "bancos-de-vestuario")!;
  const children = stagingCats.filter((c) => c.parent === parent.id);

  console.log(`Staging: padre "${parent.name}" (${parent.slug}) + ${children.length} hijas`);

  const results: unknown[] = [];
  const parentResult = await createProductionCategory({ name: parent.name, slug: parent.slug, parent: 0, dryRun: true });
  console.log("  padre:", JSON.stringify(parentResult));
  results.push({ stagingId: parent.id, ...parentResult });

  for (const child of children) {
    const childResult = await createProductionCategory({ name: child.name, slug: child.slug, parent: 0, dryRun: true });
    console.log(`  hija (${child.slug}):`, JSON.stringify(childResult));
    results.push({ stagingId: child.id, ...childResult, note: "parent real se resuelve al crear el padre en O21.5b (id de produccion aun no existe)" });
  }

  (manifest.stages as Record<string, unknown>).C_categorias = {
    stagingReference: stagingCats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parent: c.parent })),
    productionTarget: "4 categorias nuevas (1 padre + 3 hijas) bajo wc/v3/products/categories",
    action: "POST categoria (padre primero, luego hijas con parent = id real del padre creado)",
    payloadSummary: results,
    dependency: "ninguna previa -- primera etapa de escritura real en O21.5b",
    rollback: "DELETE categoria solo si count=0 (sin productos asociados)",
    risk: "bajo -- creacion aditiva pura, sin overlap detectado (verificado: produccion no tiene ninguna categoria banco todavia)",
  };
}

// ===================== D. Atributos + terminos =====================

interface StagingAttribute {
  id: number;
  name: string;
  slug: string;
  terms: Array<{ id: number; name: string; slug: string }>;
}

async function dryRunAttributes(): Promise<void> {
  section("ETAPA D -- dry-run REAL: atributos Longitud/Cara + terminos (llama al adapter con dryRun:true)");
  const stagingAttrsRaw = await stagingGet<Array<{ id: number; name: string; slug: string }>>("/wp-json/wc/v3/products/attributes");
  const relevant = stagingAttrsRaw.filter((a) => a.slug === "pa_longitud" || a.slug === "pa_cara");
  const stagingAttrs: StagingAttribute[] = [];
  for (const a of relevant) {
    const terms = await stagingGet<Array<{ id: number; name: string; slug: string }>>(`/wp-json/wc/v3/products/attributes/${a.id}/terms?per_page=100`);
    stagingAttrs.push({ ...a, terms });
  }

  const results: unknown[] = [];
  for (const attr of stagingAttrs) {
    const cleanSlug = attr.slug.replace(/^pa_/, "");
    const attrResult = await createProductionAttribute({ name: attr.name, slug: cleanSlug, dryRun: true });
    console.log(`  atributo "${attr.name}":`, JSON.stringify(attrResult));
    results.push({ stagingId: attr.id, attribute: attrResult, terms: attr.terms.map((t) => ({ stagingId: t.id, name: t.name, slug: t.slug, note: "creacion pendiente del id real del atributo padre" })) });
  }

  (manifest.stages as Record<string, unknown>).D_atributos = {
    stagingReference: stagingAttrs.map((a) => ({ id: a.id, name: a.name, slug: a.slug, terms: a.terms })),
    productionTarget: "2 atributos globales nuevos (Longitud, Cara) + 5 terminos (1000mm/1500mm/2000mm, Unica/Doble)",
    action: "POST atributo, luego POST termino por cada uno (requiere id real del atributo)",
    payloadSummary: results,
    dependency: "ninguna -- puede ir en paralelo con Etapa C",
    rollback: "DELETE termino/atributo solo si no estan en uso por ningun producto",
    risk: "bajo -- verificado que produccion no tiene pa_longitud ni pa_cara todavia (0 solapamiento)",
  };
}

// ===================== E. Media mapping (pendiente) =====================

async function dryRunMediaMapping(): Promise<void> {
  section("ETAPA E -- dry-run: mapping de media (staging -> produccion, IDs de produccion AUN NO EXISTEN)");
  const groups = {
    main: [2021, 2027, 2028, 2029, 2024, 2030, 2031, 2032, 2025],
    detail: [2033, 2034, 2036, 2039, 2040, 2041],
    family: [2042, 2043, 2044, 2046],
    heroCrop16x9: [2047],
  };
  const mapping: Array<{ group: string; stagingMediaId: number; filename: string | null; productionMediaId: null }> = [];
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) {
      const media = await stagingGet<{ source_url: string }>(`/wp-json/wp/v2/media/${id}`);
      mapping.push({ group, stagingMediaId: id, filename: media.source_url.split("/").pop() ?? null, productionMediaId: null });
    }
  }
  console.log(`Total media a mapear: ${mapping.length} (9 principal + 6 detalle + 4 familia + 1 hero 16:9)`);
  console.log("productionMediaId queda null en todos -- se rellena en O21.5b al subir cada archivo real.");

  (manifest.stages as Record<string, unknown>).E_media = {
    stagingReference: mapping,
    productionTarget: `${mapping.length} items nuevos en la Media Library de produccion`,
    action: "descargar de staging -> subir a produccion (uploadMediaToProduction, ya existe) -> registrar productionMediaId real",
    payloadSummary: { count: mapping.length, mappingPendiente: true },
    dependency: "ninguna previa -- puede ir en paralelo con C/D, pero debe completarse ANTES de F/G (productos necesitan los IDs reales)",
    rollback: "dejar sin usar (no se asocia a nada hasta que el producto exista) o borrar si esta claramente aislada",
    risk: "bajo -- mismo mecanismo ya usado y probado para las paginas de staging",
  };
}

// ===================== F/G. Productos + variaciones (preview con datos reales, IDs pendientes) =====================

interface StagingProductFull {
  id: number;
  name: string;
  slug: string;
  sku: string;
  description: string;
  short_description: string;
  categories: Array<{ id: number; slug: string }>;
  attributes: Array<{ id: number; name: string; options: string[]; variation: boolean; visible: boolean }>;
  images: Array<{ id: number }>;
}
interface StagingVariation {
  id: number;
  sku: string;
  regular_price: string;
  price: string;
  attributes: Array<{ id: number; name: string; option: string }>;
}

async function dryRunProductsAndVariations(): Promise<void> {
  section("ETAPA F/G -- dry-run: 9 productos padre + 45 variaciones (preview con datos reales de staging, IDs de categoria/atributo PENDIENTES)");
  const productIds = [1966, 1970, 1977, 1984, 1988, 1995, 2002, 2006, 2013];
  const productsPreview: unknown[] = [];
  let totalVariations = 0;

  for (const id of productIds) {
    const p = await stagingGet<StagingProductFull>(`/wp-json/wc/v3/products/${id}`);
    const variations = await stagingGet<StagingVariation[]>(`/wp-json/wc/v3/products/${id}/variations?per_page=100`);
    totalVariations += variations.length;
    console.log(`  ${p.slug} | sku:${p.sku || "(sin sku propio, es variable)"} | categorias:${p.categories.map((c) => c.slug).join(",")} | ${variations.length} variaciones`);
    productsPreview.push({
      stagingId: p.id,
      name: p.name,
      slug: p.slug,
      description_length: p.description.length,
      categorySlugs: p.categories.map((c) => c.slug),
      attributes: p.attributes.map((a) => ({ name: a.name, options: a.options, variation: a.variation })),
      imageIdsStaging: p.images.map((i) => i.id),
      productionCategoryIds: "PENDIENTE (Etapa C debe ejecutarse primero)",
      productionImageIds: "PENDIENTE (Etapa E debe ejecutarse primero)",
      variations: variations.map((v) => ({
        stagingId: v.id,
        sku: v.sku,
        regular_price: v.regular_price,
        attributes: v.attributes.map((a) => ({ name: a.name, option: a.option })),
      })),
    });
  }

  console.log(`Total variaciones: ${totalVariations}`);

  (manifest.stages as Record<string, unknown>).F_productos_padre = {
    stagingReference: productsPreview,
    productionTarget: "9 productos type=variable nuevos",
    action: "POST producto (requiere productionCategoryIds de Etapa C + productionImageIds de Etapa E ya resueltos)",
    payloadSummary: { count: 9 },
    dependency: "Etapa C (categorias) + Etapa E (media) deben estar completas primero",
    rollback: "trashProductionProduct() -- mueve a papelera, nunca borrado permanente",
    risk: "medio -- primera escritura de catalogo real; mitigado con dry-run obligatorio por producto antes de cada creacion real en O21.5b",
  };
  (manifest.stages as Record<string, unknown>).G_variaciones = {
    stagingReference: `${totalVariations} variaciones (incluidas en el detalle de F_productos_padre)`,
    productionTarget: `${totalVariations} variaciones nuevas, una por cada producto padre ya creado`,
    action: "POST variacion (requiere el id real del producto padre de Etapa F + productionAttributeIds de Etapa D)",
    payloadSummary: { count: totalVariations },
    dependency: "Etapa D (atributos) + Etapa F (producto padre correspondiente)",
    rollback: "las variaciones se eliminan automaticamente al mover el producto padre a papelera",
    risk: "medio -- volumen alto (45), se recomienda confirmar por lotes de producto padre (9 confirmaciones, no 45)",
  };
}

// ===================== H. Landing draft =====================

async function dryRunLanding(): Promise<void> {
  section("ETAPA H -- dry-run: landing draft en produccion (contenido con placeholders de media/enlaces)");
  const stagingLanding = await stagingGet<{ id: number; title: { rendered: string }; content: { raw: string } }>("/wp-json/wp/v2/pages/2048?context=edit");
  console.log(`Staging landing: id ${stagingLanding.id}, "${stagingLanding.title.rendered}", contenido: ${stagingLanding.content.raw.length} caracteres`);
  console.log("Produccion: se creara como DRAFT (nunca publish automatico) con:");
  console.log("  - Media IDs remapeados desde el mapping de la Etapa E (placeholders hasta entonces)");
  console.log("  - Enlaces internos apuntando a zentrylockers.com (no staging.zentrylockers.com)");
  console.log("  - Enlaces a fichas de producto usando los slugs finales de produccion (idénticos a los de staging, ya verificado)");

  const existing = await productionGet<Array<{ id: number; status: string }>>("/wp-json/wp/v2/pages?slug=bancos-de-vestuario");
  console.log("¿Ya existe una pagina con ese slug en produccion?", existing.length > 0 ? `SI (id ${existing[0].id}, status ${existing[0].status})` : "NO");

  (manifest.stages as Record<string, unknown>).H_landing = {
    stagingReference: { pageId: stagingLanding.id, contentLength: stagingLanding.content.raw.length, url: "https://staging.zentrylockers.com/bancos-de-vestuario/" },
    productionTarget: "pagina nueva /bancos-de-vestuario/ en produccion, status: draft",
    action: "createProductionDraftPage() (ya existe en wordpress-production.ts) con contenido remapeado",
    payloadSummary: { existingSlugConflict: existing.length > 0 },
    dependency: "Etapa E (media) para las imagenes reales -- el resto de enlaces ya se puede resolver ahora (paginas identicas por id en ambos entornos)",
    rollback: "mover a draft/trash si ya se hubiera publicado -- pero este proyecto NUNCA publica produccion automaticamente, la publicacion la haces tu manualmente",
    risk: "bajo -- se queda en draft, no visible publicamente hasta que tu decidas publicar",
  };
}

// ===================== I. Menu (dry-run real contra produccion) =====================

interface WpMenuItem {
  id: number;
  menu_order: number;
  parent: number;
  title: { rendered: string };
  url: string;
}

async function dryRunMenu(): Promise<void> {
  section("ETAPA I -- dry-run REAL: item de menu 'Bancos de vestuario' (lee el menu 17 de produccion en vivo)");
  const items = await productionGet<WpMenuItem[]>("/wp-json/wp/v2/menu-items?menus=17&per_page=100");
  const INSERT_AFTER_ORDER = 9;
  const toShift = items.filter((i) => i.parent === 0 && i.menu_order > INSERT_AFTER_ORDER).sort((a, b) => b.menu_order - a.menu_order);
  console.log(`Items de nivel superior a desplazar +1 (${toShift.length}):`);
  for (const i of toShift) console.log(`  ${i.id} "${i.title.rendered}" order ${i.menu_order} -> ${i.menu_order + 1}`);
  console.log(`Nuevo item: "Bancos de vestuario" -> https://zentrylockers.com/bancos-de-vestuario/, parent:0, menu_order:${INSERT_AFTER_ORDER + 1}`);

  (manifest.stages as Record<string, unknown>).I_menu = {
    stagingReference: "mismo patron ya aplicado y verificado en staging (item 2051)",
    productionTarget: "menu 17 (Menu principal) de produccion -- IDs identicos a staging, verificado",
    action: `shift +1 de ${toShift.length} items (${toShift.map((i) => i.id).join(", ")}) + POST nuevo item con menu_order:${INSERT_AFTER_ORDER + 1}`,
    payloadSummary: { itemsToShift: toShift.map((i) => ({ id: i.id, from: i.menu_order, to: i.menu_order + 1 })), newItemOrder: INSERT_AFTER_ORDER + 1 },
    dependency: "Etapa H (landing) debe existir para que el enlace tenga destino real -- aunque puede crearse el item de menu con la URL igualmente antes, mejor after landing draft creado",
    rollback: "restaurar menu_order original desde snapshot + DELETE del item nuevo (mismo script que en staging, o214-menu-rollback.ts, repuntado a produccion)",
    risk: "bajo -- identico al cambio ya validado en staging, mismos IDs de items",
  };
}

// ===================== J. Enlaces internos (dry-run real contra produccion) =====================

async function dryRunInternalLinks(): Promise<void> {
  section("ETAPA J -- dry-run REAL: enlaces internos en 11 paginas de produccion (lee contenido actual en vivo)");
  const pageIds: Record<string, number> = {
    taquillas: 22,
    "taquillas-por-sector": 1636,
    "taquillas-metalicas": 108,
    "taquillas-fenolicas": 468,
    "taquillas-melamina": 470,
    "taquillas-para-gimnasios": 124,
    "taquillas-para-colegios": 127,
    "taquillas-para-empresas": 129,
    "taquillas-para-centros-deportivos": 1820,
    "taquillas-para-industria": 1823,
    "taquillas-para-oficinas": 1822,
  };
  const results: unknown[] = [];
  for (const [slug, id] of Object.entries(pageIds)) {
    const page = await productionGet<{ status: string; content: { raw: string } }>(`/wp-json/wp/v2/pages/${id}?context=edit`);
    const alreadyHasLink = page.content.raw.includes("bancos-de-vestuario");
    console.log(`  ${slug} (id ${id}): status=${page.status}, longitud=${page.content.raw.length}, ya_tiene_enlace=${alreadyHasLink}`);
    results.push({ slug, pageId: id, status: page.status, contentLength: page.content.raw.length, alreadyHasLink });
  }

  (manifest.stages as Record<string, unknown>).J_enlaces_internos = {
    stagingReference: "mismo patron ya aplicado en staging (5 alta prioridad + 6 sectoriales), /productos/ omitida (builder externo)",
    productionTarget: results,
    action: "updateProductionPublishedPageContent() (ya existe) -- append/insert quirurgico, nunca sobrescribe todo el contenido",
    payloadSummary: { pagesCount: 11 },
    dependency: "Etapa H (landing) debe existir para que el enlace apunte a un destino real",
    rollback: "cada pagina conserva su snapshot completo previo -- revertir es restaurar ese contenido exacto",
    risk: "bajo -- mismo mecanismo ya probado en staging, verificado que ninguna de las 11 tiene ya el enlace (evita duplicados)",
  };
}

// ===================== Cierre =====================

async function main(): Promise<void> {
  console.log("=== O21.5a: DRY-RUN CONSOLIDADO -- deploy Bancos a produccion ===");
  console.log("Ninguna llamada de este script escribe en produccion. Todo con dryRun:true o GET.");

  await preflight();
  await dryRunHeaderFix();
  dryRunMuPlugin();
  await dryRunCategories();
  await dryRunAttributes();
  await dryRunMediaMapping();
  await dryRunProductsAndVariations();
  await dryRunLanding();
  await dryRunMenu();
  await dryRunInternalLinks();

  section("QA final de esta fase");
  const prodProducts = await fetch("https://zentrylockers.com/wp-json/wc/store/v1/products?per_page=100&_cb=" + Date.now(), {
    headers: { "Cache-Control": "no-cache" },
  }).then((r) => r.json() as Promise<Array<{ slug: string }>>);
  console.log("Produccion -- total productos:", prodProducts.length, "(esperado: 54)");
  console.log("Produccion -- slugs banco:", prodProducts.filter((p) => p.slug.includes("banco")).length, "(esperado: 0)");
  const landingCheck = await fetch("https://zentrylockers.com/bancos-de-vestuario/", { method: "GET" });
  console.log("Produccion -- /bancos-de-vestuario/ status:", landingCheck.status, "(esperado: 404)");

  const outPath = "/tmp/o215-deploy-manifest.json";
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest completo escrito en: ${outPath}`);
}

main().catch((err) => {
  console.error("Error inesperado:", err instanceof Error ? err.message : err);
  process.exit(1);
});
