require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wp/v2/themes", { headers: { Authorization: prod.auth } });
  const j = await r.json();
  console.log("STATUS", r.status);
  if (Array.isArray(j)) {
    const active = j.find(t => t.status === "active");
    console.log("active theme:", JSON.stringify({ stylesheet: active.stylesheet, template: active.template, name: active.name, version: active.version, parent: active.parent }, null, 2));
  } else {
    console.log(JSON.stringify(j).slice(0,300));
  }
}
main().catch(e => console.error("ERR", e.message));
