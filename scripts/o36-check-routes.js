require("dotenv").config();
const userS = process.env.WORDPRESS_USERNAME, passS = process.env.WORDPRESS_APP_PASSWORD, baseS = process.env.WORDPRESS_STAGING_BASE_URL;
const authS = "Basic " + Buffer.from(userS + ":" + passS).toString("base64");

async function main() {
  const r = await fetch(baseS + "/wp-json/", { headers: { Authorization: authS } });
  const j = await r.json();
  const routes = Object.keys(j.routes || {});
  const wc = routes.filter(x => x.includes('/wc/') || x.includes('product') || x.includes('/wc-'));
  console.log("WooCommerce/product related routes on STAGING:");
  console.log(JSON.stringify(wc, null, 2));
}
main().catch(e => console.error("ERR", e.message));
