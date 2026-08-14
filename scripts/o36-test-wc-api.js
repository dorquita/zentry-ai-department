require("dotenv").config();
const userS = process.env.WORDPRESS_USERNAME, passS = process.env.WORDPRESS_APP_PASSWORD, baseS = process.env.WORDPRESS_STAGING_BASE_URL;
const authS = "Basic " + Buffer.from(userS + ":" + passS).toString("base64");

async function main() {
  const r = await fetch(baseS + "/wp-json/wc/v3/products?per_page=1", { headers: { Authorization: authS } });
  console.log("STATUS", r.status);
  const j = await r.json();
  console.log(JSON.stringify(j).slice(0, 500));
}
main().catch(e => console.error("ERR", e.message));
