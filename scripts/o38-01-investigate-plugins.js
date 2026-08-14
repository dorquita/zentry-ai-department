require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // full plugin list with descriptions, look for anything unusual/custom
  const r = await fetch(prod.base + "/wp-json/wp/v2/plugins", { headers: { Authorization: prod.auth } });
  const list = await r.json();
  const active = list.filter(p => p.status === "active");
  console.log("=== ALL ACTIVE PLUGINS with descriptions ===");
  for (const p of active) {
    console.log("-", p.plugin, "|", p.name, "|", p.author, "|", (p.description.raw||"").slice(0,120));
  }

  console.log("\n=== post types ===");
  const tr = await fetch(prod.base + "/wp-json/wp/v2/types", { headers: { Authorization: prod.auth } });
  const types = await tr.json();
  console.log(Object.keys(types));
  for (const [k,v] of Object.entries(types)) {
    if (/code|snippet|wpcode|zentry/i.test(k) || /code|snippet|wpcode|zentry/i.test(v.name||"")) {
      console.log("MATCH:", k, JSON.stringify(v).slice(0,200));
    }
  }
}
main().catch(e => console.error("ERR", e.message));
