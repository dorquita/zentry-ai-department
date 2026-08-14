require("dotenv").config();
const fs = require("fs");

const prod = {
  auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"),
  base: process.env.WORDPRESS_PRODUCTION_BASE_URL,
};

async function fetchAllProducts() {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(prod.base + "/wp-json/wc/v3/products?per_page=100&page=" + page + "&status=any&orderby=id&order=asc", { headers: { Authorization: prod.auth } });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function fetchVariations(productId) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + productId + "/variations?per_page=100&page=" + page + "&status=any", { headers: { Authorization: prod.auth } });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function main() {
  console.log("Fetching all production products (full detail)...");
  const products = await fetchAllProducts();
  console.log("products:", products.length);

  console.log("Fetching variations for each variable product...");
  const variationsByProduct = {};
  for (const p of products) {
    if (p.type === "variable") {
      variationsByProduct[p.id] = await fetchVariations(p.id);
    }
  }
  const totalVariations = Object.values(variationsByProduct).reduce((s, v) => s + v.length, 0);
  console.log("total variations backed up:", totalVariations);

  const catsR = await fetch(prod.base + "/wp-json/wc/v3/products/categories?per_page=100", { headers: { Authorization: prod.auth } });
  const categories = await catsR.json();

  const attrsR = await fetch(prod.base + "/wp-json/wc/v3/products/attributes?per_page=100", { headers: { Authorization: prod.auth } });
  const attributes = await attrsR.json();

  const accSettingsR = await fetch(prod.base + "/wp-json/wc/v3/settings/account", { headers: { Authorization: prod.auth } });
  const accountSettings = await accSettingsR.json();

  const pluginR = await fetch(prod.base + "/wp-json/wp/v2/plugins/elex-woocommerce-catalog-mode/elex-catalog-mode", { headers: { Authorization: prod.auth } });
  const catalogModePlugin = await pluginR.json();

  const backup = {
    timestamp: new Date().toISOString(),
    products,
    variationsByProduct,
    categories,
    attributes,
    guest_checkout_setting: (accountSettings.find((s) => s.id === "woocommerce_enable_guest_checkout") || {}).value,
    catalog_mode_plugin_status: catalogModePlugin.status,
  };

  fs.writeFileSync("/opt/zentry-ai-department/reports/o37-production-backup-FULL.json", JSON.stringify(backup, null, 2));
  console.log("\nBackup written to reports/o37-production-backup-FULL.json");
  console.log("guest_checkout_setting:", backup.guest_checkout_setting);
  console.log("catalog_mode_plugin_status:", backup.catalog_mode_plugin_status);
}
main().catch((e) => console.error("ERR", e.message, e.stack));
