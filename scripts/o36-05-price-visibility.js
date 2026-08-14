require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/product/taquilla-2-puertas-modulo-1-melamina/?o36check=" + Date.now());
  console.log("cache header:", r.headers.get("x-litespeed-cache") || "(none)");
  const html = await r.text();
  const hasPrice = /woocommerce-Price-amount|<span class="woocommerce-Price-currencySymbol/i.test(html);
  const hasHiddenPriceIndicators = /consultar precio|solicitar precio|pedir presupuesto para ver el precio|price.*hidden|hide.*price/i.test(html);
  console.log("has visible WooCommerce price markup:", hasPrice);
  console.log("has 'ask for price' style text:", hasHiddenPriceIndicators);
}
main().catch(e => console.error("ERR", e.message));
