require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/taquilla-2-puertas-modulo-1-melamina/?o36check4=" + Date.now());
  const html = await r.text();
  const idx = html.indexOf('zentry-price-cta__title');
  const idx2 = html.indexOf('zentry-price-cta', idx + 2000);
  console.log(html.slice(idx, idx2 > 0 ? idx2 : idx + 1200));
}
main().catch(e => console.error("ERR", e.message));
