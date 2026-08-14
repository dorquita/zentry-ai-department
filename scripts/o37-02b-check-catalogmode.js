require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/wp/v2/plugins", { headers: { Authorization: auth } });
  const list = await r.json();
  const p = list.find(x => x.plugin.includes("catalog-mode"));
  console.log(JSON.stringify(p, null, 2));
}
main().catch(e => console.error("ERR", e.message));
