require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  const list = await r.json();
  console.log("total snippets:", list.length);
  for (const s of list) {
    const hit = (s.code || "").includes("zentry-price-cta") || (s.code || "").includes("zentry_price") || /price.*cta|precio.*bajo.*solicitud/i.test(s.code || "") || /price.*cta|precio.*bajo.*solicitud/i.test(s.name || "");
    console.log(s.id, "|", s.active, "|", s.name, hit ? "  <<< MATCH (price-cta related)" : "");
  }
}
main().catch(e => console.error("ERR", e.message));
