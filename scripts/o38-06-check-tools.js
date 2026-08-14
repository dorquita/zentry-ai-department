require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/system_status/tools", { headers: { Authorization: prod.auth } });
  const j = await r.json();
  const relevant = j.filter(t => /lookup|price|regenerat|sync|transient/i.test(t.id) || /lookup|price|regenerat|sync|transient/i.test(t.name));
  console.log(JSON.stringify(relevant, null, 2));
}
main().catch(e => console.error("ERR", e.message));
