require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/wp/v2/plugins/elex-woocommerce-catalog-mode%2Felex-catalog-mode", { headers: { Authorization: auth } });
  console.log("STATUS", r.status);
  console.log(await r.text());
}
main().catch(e => console.error("ERR", e.message));
