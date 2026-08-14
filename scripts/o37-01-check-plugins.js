require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/wp/v2/plugins", { headers: { Authorization: auth } });
  console.log("STATUS", r.status);
  const j = await r.json();
  if (Array.isArray(j)) {
    console.log("total plugins:", j.length);
    for (const p of j) {
      const active = p.status === "active";
      const suspicious = /price|precio|cta|hide|oculta/i.test(p.name || "") || /price|precio|cta|hide|oculta/i.test(p.plugin || "");
      if (active) console.log(" -", p.plugin, "|", p.name, suspicious ? "  <<< MATCH" : "");
    }
  } else {
    console.log(JSON.stringify(j).slice(0, 400));
  }
}
main().catch(e => console.error("ERR", e.message));
