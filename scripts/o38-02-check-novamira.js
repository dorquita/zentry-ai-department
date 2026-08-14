require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wp/v2/plugins/novamira/novamira", { headers: { Authorization: prod.auth } });
  console.log(JSON.stringify(await r.json(), null, 2));

  const r2 = await fetch(prod.base + "/wp-json/", { headers: { Authorization: prod.auth } });
  const j2 = await r2.json();
  const routes = Object.keys(j2.routes || {}).filter(x => /novamira|mcp|dynamic/i.test(x));
  console.log("\nnovamira-related routes:", JSON.stringify(routes, null, 2));
  console.log("\nall namespaces:", JSON.stringify(j2.namespaces, null, 2));
}
main().catch(e => console.error("ERR", e.message));
