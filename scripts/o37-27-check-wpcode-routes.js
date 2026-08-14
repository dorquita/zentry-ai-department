require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/", { headers: { Authorization: prod.auth } });
  const j = await r.json();
  const routes = Object.keys(j.routes || {}).filter(x => /wpcode|ihaf|catalog|elex/i.test(x));
  console.log(JSON.stringify(routes, null, 2));
}
main().catch(e => console.error("ERR", e.message));
