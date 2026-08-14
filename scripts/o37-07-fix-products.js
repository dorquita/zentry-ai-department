require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const compare = JSON.parse(require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-compare.json", "utf8"));
  const priceDiffIds = compare.diffs.filter(d => d.diffs.some(f => f.includes("price:") || f.includes("attributes differ"))).map(d => d.id);
  console.log("products to update (price/attributes):", priceDiffIds.length);

  // fetch FULL raw staging data for these products
  const fullStaging = [];
  for (const id of priceDiffIds) {
    const r = await fetch(staging.base + "/wp-json/wc/v3/products/" + id, { headers: { Authorization: staging.auth } });
    fullStaging.push(await r.json());
  }
  require("fs").writeFileSync("/opt/zentry-ai-department/reports/o37-staging-fullraw-54.json", JSON.stringify(fullStaging, null, 2));
  console.log("fetched full staging data for", fullStaging.length, "products");

  const updates = fullStaging.map(sp => ({
    id: sp.id,
    regular_price: sp.regular_price,
    price: sp.price,
    sale_price: sp.sale_price || "",
    attributes: sp.attributes.map(a => ({
      id: a.id,
      name: a.name,
      position: a.position,
      visible: a.visible,
      variation: a.variation,
      options: a.options,
    })),
  }));

  // batch in chunks of 20
  let totalUpdated = 0;
  const errors = [];
  for (let i = 0; i < updates.length; i += 20) {
    const chunk = updates.slice(i, i + 20);
    const r = await fetch(prod.base + "/wp-json/wc/v3/products/batch", {
      method: "POST",
      headers: { Authorization: prod.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ update: chunk }),
    });
    const j = await r.json();
    if (j.update) {
      totalUpdated += j.update.length;
      for (const u of j.update) {
        if (u.error) errors.push({ id: u.id, error: u.error });
      }
    } else {
      console.log("BATCH ERROR chunk", i, JSON.stringify(j).slice(0, 500));
    }
    console.log("chunk", i, "-", i + chunk.length, "done. running total:", totalUpdated);
  }

  console.log("\nTOTAL updated:", totalUpdated, "| errors:", errors.length);
  if (errors.length) console.log(JSON.stringify(errors, null, 2));
}
main().catch(e => console.error("ERR", e.message, e.stack));
