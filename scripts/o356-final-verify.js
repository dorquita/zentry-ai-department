require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r15 = await fetch(base + "/wp-json/code-snippets/v1/snippets/15", { headers: { Authorization: auth } });
  const j15 = await r15.json();
  console.log("snippet 15:", JSON.stringify({ id: j15.id, active: j15.active, code_error: j15.code_error }));

  const rs = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  const list = await rs.json();
  console.log("total snippets in list endpoint:", list.length, "| ids:", list.map(s=>s.id).join(","));

  // PHP error sanity on home + a product page
  const rh = await fetch(base + "/?o356sanity=" + Date.now());
  const html = await rh.text();
  console.log("home: status", rh.status, "| fatal/parse error present:", /fatal error|parse error/i.test(html));
}
main().catch(e => console.error("ERR", e.message));
