require("dotenv").config();
const fs = require("fs");

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function getAll(path) {
  let page = 1;
  const all = [];
  for (;;) {
    const r = await fetch(`${base}/wp-json/wc/v3/${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, {
      headers: { Authorization: auth },
    });
    if (!r.ok) {
      console.error("FAILED", path, r.status, await r.text());
      break;
    }
    const batch = await r.json();
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return all;
}

async function main() {
  const products = await getAll("products?status=any");
  console.log(`Total products: ${products.length}`);

  const variableProducts = products.filter((p) => p.type === "variable");
  console.log(`Variable products: ${variableProducts.length}`);

  const variationsByProduct = {};
  for (const p of variableProducts) {
    const vars = await getAll(`products/${p.id}/variations`);
    variationsByProduct[p.id] = vars;
  }

  const categories = await getAll("products/categories");
  const attributes = await getAll("products/attributes");

  fs.writeFileSync(
    "/tmp/o33-products.json",
    JSON.stringify({ products, variationsByProduct, categories, attributes }, null, 2)
  );
  console.log("Saved to /tmp/o33-products.json");
  console.log(`Categories: ${categories.length}, global attributes: ${attributes.length}`);
}

main().catch((e) => console.error("ERR", e.message));
