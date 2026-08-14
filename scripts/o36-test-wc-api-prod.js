require("dotenv").config();
const userP = process.env.WORDPRESS_PRODUCTION_USERNAME, passP = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD, baseP = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const authP = "Basic " + Buffer.from(userP + ":" + passP).toString("base64");

async function main() {
  const r = await fetch(baseP + "/wp-json/wc/v3/products?per_page=1", { headers: { Authorization: authP } });
  console.log("STATUS", r.status);
  const j = await r.json();
  console.log(JSON.stringify(j).slice(0, 500));
}
main().catch(e => console.error("ERR", e.message));
