require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/taquilla-2-puertas-modulo-1-melamina/?o37fresh=" + Date.now() + Math.random());
  console.log("cache header:", r.headers.get("x-litespeed-cache") || "(none)");
  const html = await r.text();
  const idx = html.indexOf('summary entry-summary');
  console.log(html.slice(idx, idx + 500));
}
main().catch(e => console.error("ERR", e.message));
