require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  console.log("STATUS", r.status);
  const j = await r.json();
  if (Array.isArray(j)) {
    console.log("Snippets found:", j.length);
    for (const s of j) console.log(s.id, "|", s.active, "|", s.name);
  } else {
    console.log(JSON.stringify(j).slice(0, 300));
  }
}
main().catch(e => console.error("ERR", e.message));
