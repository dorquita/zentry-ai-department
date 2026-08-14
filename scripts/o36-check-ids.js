require("dotenv").config();
const auth = "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64");
const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function main() {
  for (const id of [1286, 603]) {
    const r = await fetch(base + "/wp-json/wc/v3/products/" + id, { headers: { Authorization: auth } });
    if (r.status !== 200) { console.log(id, "-> status", r.status); continue; }
    const p = await r.json();
    console.log(id, "->", p.name, "| status:", p.status, "| type:", p.type, "| sku:", p.sku, "| price:", p.price);
  }
}
main().catch(e => console.error("ERR", e.message));
