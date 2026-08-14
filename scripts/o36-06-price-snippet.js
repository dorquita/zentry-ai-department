require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/taquilla-2-puertas-modulo-1-melamina/?o36check2=" + Date.now());
  const html = await r.text();
  const idx = html.search(/consultar precio|solicitar precio|pedir presupuesto para ver el precio/i);
  console.log(html.slice(Math.max(0, idx - 300), idx + 300));
}
main().catch(e => console.error("ERR", e.message));
