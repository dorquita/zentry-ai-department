require("dotenv").config();
const fs = require("fs");

const staging = {
  auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"),
  base: process.env.WORDPRESS_STAGING_BASE_URL,
};
const prod = {
  auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"),
  base: process.env.WORDPRESS_PRODUCTION_BASE_URL,
};

async function fetchAllProducts(env) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(env.base + "/wp-json/wc/v3/products?per_page=100&page=" + page + "&status=any&orderby=id&order=asc", {
      headers: { Authorization: env.auth },
    });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function fetchVariations(env, productId) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products/" + productId + "/variations?per_page=100&status=any", {
    headers: { Authorization: env.auth },
  });
  if (r.status !== 200) return [];
  return await r.json();
}

async function fetchCategories(env) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products/categories?per_page=100", { headers: { Authorization: env.auth } });
  return await r.json();
}

async function fetchAttributes(env) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products/attributes?per_page=100", { headers: { Authorization: env.auth } });
  return await r.json();
}

function slim(p) {
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    type: p.type,
    status: p.status,
    price: p.price,
    regular_price: p.regular_price,
    stock_status: p.stock_status,
    categories: (p.categories || []).map((c) => c.slug).sort(),
    attributes: (p.attributes || []).map((a) => a.name + ":" + (a.options || []).join("|")).sort(),
    image_count: (p.images || []).length,
    has_real_image: (p.images || []).length > 0 && !(p.images[0].src || "").includes("placeholder"),
    date_modified: p.date_modified,
  };
}

async function main() {
  console.log("Fetching full product lists...");
  const [stagingProducts, prodProducts] = await Promise.all([fetchAllProducts(staging), fetchAllProducts(prod)]);
  console.log("staging total:", stagingProducts.length, "| production total:", prodProducts.length);

  const [stagingCats, prodCats] = await Promise.all([fetchCategories(staging), fetchCategories(prod)]);
  const [stagingAttrs, prodAttrs] = await Promise.all([fetchAttributes(staging), fetchAttributes(prod)]);

  const stagingSlim = stagingProducts.map(slim);
  const prodSlim = prodProducts.map(slim);

  const stagingById = new Map(stagingSlim.map((p) => [p.id, p]));
  const prodById = new Map(prodSlim.map((p) => [p.id, p]));

  const onlyInStaging = stagingSlim.filter((p) => !prodById.has(p.id));
  const onlyInProd = prodSlim.filter((p) => !stagingById.has(p.id));
  const inBoth = stagingSlim.filter((p) => prodById.has(p.id));

  const diffs = [];
  for (const sp of inBoth) {
    const pp = prodById.get(sp.id);
    const fieldDiffs = [];
    if (sp.price !== pp.price) fieldDiffs.push("price: staging=" + sp.price + " prod=" + pp.price);
    if (sp.regular_price !== pp.regular_price) fieldDiffs.push("regular_price: staging=" + sp.regular_price + " prod=" + pp.regular_price);
    if (sp.status !== pp.status) fieldDiffs.push("status: staging=" + sp.status + " prod=" + pp.status);
    if (sp.type !== pp.type) fieldDiffs.push("type: staging=" + sp.type + " prod=" + pp.type);
    if (JSON.stringify(sp.categories) !== JSON.stringify(pp.categories)) fieldDiffs.push("categories differ: staging=" + sp.categories.join(",") + " prod=" + pp.categories.join(","));
    if (JSON.stringify(sp.attributes) !== JSON.stringify(pp.attributes)) fieldDiffs.push("attributes differ");
    if (sp.image_count !== pp.image_count) fieldDiffs.push("image_count: staging=" + sp.image_count + " prod=" + pp.image_count);
    if (sp.has_real_image !== pp.has_real_image) fieldDiffs.push("has_real_image: staging=" + sp.has_real_image + " prod=" + pp.has_real_image);
    if (fieldDiffs.length > 0) {
      diffs.push({ id: sp.id, sku: sp.sku, name: sp.name, diffs: fieldDiffs });
    }
  }

  // categories diff
  const stagingCatSlugs = new Set(stagingCats.map((c) => c.slug));
  const prodCatSlugs = new Set(prodCats.map((c) => c.slug));
  const catsOnlyStaging = [...stagingCatSlugs].filter((s) => !prodCatSlugs.has(s));
  const catsOnlyProd = [...prodCatSlugs].filter((s) => !stagingCatSlugs.has(s));

  // attributes diff
  const stagingAttrSlugs = new Set(stagingAttrs.map((a) => a.slug));
  const prodAttrSlugs = new Set(prodAttrs.map((a) => a.slug));
  const attrsOnlyStaging = [...stagingAttrSlugs].filter((s) => !prodAttrSlugs.has(s));
  const attrsOnlyProd = [...prodAttrSlugs].filter((s) => !stagingAttrSlugs.has(s));

  const noRealImageStaging = stagingSlim.filter((p) => p.status !== "private" && !p.has_real_image);
  const noRealImageProd = prodSlim.filter((p) => !p.has_real_image);

  const report = {
    generated_at: new Date().toISOString(),
    counts: {
      staging_total: stagingProducts.length,
      production_total: prodProducts.length,
      only_in_staging: onlyInStaging.length,
      only_in_production: onlyInProd.length,
      in_both: inBoth.length,
      products_with_diffs: diffs.length,
    },
    only_in_staging: onlyInStaging,
    only_in_production: onlyInProd,
    diffs,
    categories: { staging_count: stagingCats.length, production_count: prodCats.length, only_in_staging: catsOnlyStaging, only_in_production: catsOnlyProd },
    attributes: { staging_count: stagingAttrs.length, production_count: prodAttrs.length, only_in_staging: attrsOnlyStaging, only_in_production: attrsOnlyProd },
    images: { staging_missing_real_image_count: noRealImageStaging.length, production_missing_real_image_count: noRealImageProd.length },
  };

  fs.writeFileSync("/opt/zentry-ai-department/reports/o36-catalog-compare.json", JSON.stringify(report, null, 2));
  fs.writeFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", JSON.stringify(stagingSlim, null, 2));
  fs.writeFileSync("/opt/zentry-ai-department/reports/o36-catalog-production-full.json", JSON.stringify(prodSlim, null, 2));

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(report.counts, null, 2));
  console.log("\nonly_in_staging:", onlyInStaging.map((p) => p.id + ":" + p.name + " [" + p.status + "]").join(" | "));
  console.log("\nonly_in_production:", onlyInProd.map((p) => p.id + ":" + p.name + " [" + p.status + "]").join(" | "));
  console.log("\ncategories only_in_staging:", catsOnlyStaging.join(", "));
  console.log("categories only_in_production:", catsOnlyProd.join(", "));
  console.log("\nattributes only_in_staging:", attrsOnlyStaging.join(", "));
  console.log("attributes only_in_production:", attrsOnlyProd.join(", "));
  console.log("\nimages missing real photo -> staging:", noRealImageStaging.length, "| production:", noRealImageProd.length);
  console.log("\nproducts with field diffs:", diffs.length);
  for (const d of diffs.slice(0, 80)) {
    console.log("  #" + d.id, d.sku || "(no sku)", "-", d.name);
    for (const f of d.diffs) console.log("      -", f);
  }
  if (diffs.length > 80) console.log("  ... and", diffs.length - 80, "more (see full report file)");
}
main().catch((e) => console.error("ERR", e.message, e.stack));
