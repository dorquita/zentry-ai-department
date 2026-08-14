require("dotenv").config();
const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/taquilla-2-puertas-modulo-1-melamina/?o37fresh=" + Date.now());
  const html = await r.text();
  const idx = html.indexOf('summary entry-summary');
  console.log(html.slice(idx, idx + 700));
}
main().catch(e => console.error("ERR", e.message));
