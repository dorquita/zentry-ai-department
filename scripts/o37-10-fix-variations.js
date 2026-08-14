require("dotenv").config();
const fs = require("fs");

const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function fetchAllVariations(env, productId) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(env.base + "/wp-json/wc/v3/products/" + productId + "/variations?per_page=100&page=" + page, { headers: { Authorization: env.auth } });
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

function comboKey(v) {
  return v.attributes.map((a) => (a.name + "=" + a.option).toLowerCase()).sort().join("|");
}

async function main() {
  const stagingProducts = JSON.parse(fs.readFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", "utf8"));
  const variableIds = stagingProducts.filter((p) => p.type === "variable").map((p) => p.id);
  console.log("variable products to process:", variableIds.length);

  const summary = [];
  let totalCreated = 0,
    totalUpdated = 0,
    totalErrors = 0;

  for (const pid of variableIds) {
    const [stagingVars, prodVars] = await Promise.all([fetchAllVariations(staging, pid), fetchAllVariations(prod, pid)]);

    const prodByCombo = new Map(prodVars.map((v) => [comboKey(v), v]));

    const toCreate = [];
    const toUpdate = [];

    for (const sv of stagingVars) {
      const key = comboKey(sv);
      const payload = {
        regular_price: sv.regular_price,
        price: sv.price,
        sale_price: sv.sale_price || "",
        sku: sv.sku || "",
        attributes: sv.attributes.map((a) => ({ id: a.id, name: a.name, option: a.option })),
        manage_stock: sv.manage_stock,
        stock_status: sv.stock_status,
      };
      const existing = prodByCombo.get(key);
      if (existing) {
        if (existing.regular_price !== sv.regular_price || existing.price !== sv.price || existing.sku !== sv.sku) {
          toUpdate.push({ id: existing.id, ...payload });
        }
      } else {
        toCreate.push(payload);
      }
    }

    let created = 0,
      updated = 0,
      errs = [];
    if (toCreate.length || toUpdate.length) {
      // chunk to be safe with payload size
      const CHUNK = 40;
      for (let i = 0; i < Math.max(toCreate.length, toUpdate.length); i += CHUNK) {
        const body = {};
        const cChunk = toCreate.slice(i, i + CHUNK);
        const uChunk = toUpdate.slice(i, i + CHUNK);
        if (cChunk.length) body.create = cChunk;
        if (uChunk.length) body.update = uChunk;
        if (!body.create && !body.update) continue;

        const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + pid + "/variations/batch", {
          method: "POST",
          headers: { Authorization: prod.auth, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j.create) {
          created += j.create.length;
          j.create.forEach((c) => { if (c.error) errs.push({ op: "create", error: c.error }); });
        }
        if (j.update) {
          updated += j.update.length;
          j.update.forEach((u) => { if (u.error) errs.push({ op: "update", id: u.id, error: u.error }); });
        }
        if (!j.create && !j.update) {
          errs.push({ op: "batch", error: JSON.stringify(j).slice(0, 300) });
        }
      }
    }

    totalCreated += created;
    totalUpdated += updated;
    totalErrors += errs.length;
    summary.push({ productId: pid, stagingCount: stagingVars.length, prodCountBefore: prodVars.length, created, updated, errors: errs });
    console.log(pid, "| staging:", stagingVars.length, "| prod before:", prodVars.length, "| created:", created, "| updated:", updated, errs.length ? "| ERRORS: " + JSON.stringify(errs).slice(0,200) : "");
  }

  fs.writeFileSync("/opt/zentry-ai-department/reports/o37-variations-migration-summary.json", JSON.stringify(summary, null, 2));
  console.log("\n=== TOTAL ===");
  console.log("created:", totalCreated, "| updated:", totalUpdated, "| errors:", totalErrors);
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
