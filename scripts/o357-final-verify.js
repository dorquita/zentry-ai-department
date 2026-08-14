require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r16 = await fetch(base + "/wp-json/code-snippets/v1/snippets/16", { headers: { Authorization: auth } });
  const j16 = await r16.json();
  console.log("snippet 16:", JSON.stringify({ id: j16.id, active: j16.active, code_error: j16.code_error }));

  const r15 = await fetch(base + "/wp-json/code-snippets/v1/snippets/15", { headers: { Authorization: auth } });
  const j15 = await r15.json();
  console.log("snippet 15 (visual fix, untouched):", JSON.stringify({ id: j15.id, active: j15.active, code_error: j15.code_error }));

  const rs = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  const list = await rs.json();
  console.log("total snippets:", list.length, "| ids:", list.map(s=>s.id).join(","));

  const rh = await fetch(base + "/?o357sanity=" + Date.now());
  const html = await rh.text();
  console.log("home status:", rh.status, "| fatal/parse error present:", /fatal error|parse error/i.test(html));
}
main().catch(e => console.error("ERR", e.message));
