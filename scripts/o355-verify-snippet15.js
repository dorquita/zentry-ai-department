require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const rs = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  const snippets = await rs.json();
  console.log("total count:", snippets.length);
  console.log("ids:", snippets.map(s => s.id).join(","));

  const r15 = await fetch(base + "/wp-json/code-snippets/v1/snippets/15", { headers: { Authorization: auth } });
  const j15 = await r15.json();
  console.log("\nsnippet 15 direct fetch:", JSON.stringify({ id: j15.id, active: j15.active, name: j15.name, code_error: j15.code_error }));
}
main().catch(e => console.error("ERR", e.message));
