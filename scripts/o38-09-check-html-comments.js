require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/neo/?o38check=" + Date.now());
  const html = await r.text();
  // search wider window around the price CTA for any generator comments
  const idx = html.indexOf('zentry-price-cta');
  console.log(html.slice(Math.max(0, idx - 1500), idx + 100));
}
main().catch(e => console.error("ERR", e.message));
