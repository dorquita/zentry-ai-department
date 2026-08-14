require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function check(path) {
  const r = await fetch(base + path, { method: "OPTIONS", headers: { Authorization: auth } });
  const j = await r.json().catch(() => null);
  console.log("OPTIONS", path, "-> status", r.status);
  if (j && j.endpoints) {
    for (const e of j.endpoints) console.log("  methods:", e.methods);
  } else {
    console.log("  body:", JSON.stringify(j).slice(0, 300));
  }
}

async function main() {
  await check("/wp-json/complianz/v1/documents");
  await check("/wp-json/complianz/v1");
}
main().catch(e => console.error("ERR", e.message));
