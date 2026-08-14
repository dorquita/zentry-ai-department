require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  // confirm snippet list unchanged except new #15
  const rs = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  const snippets = await rs.json();
  console.log("=== Snippets on production now ===");
  for (const s of snippets) console.log(s.id, "|", s.active, "|", s.name);

  // check a product page for PHP errors + presence of our fix
  const r = await fetch(base + "/?post_type=product&s=&o355check=" + Date.now());
  console.log("\n=== Homepage sanity ===");
  const html = await r.text();
  console.log("status:", r.status, "| has o355 style:", html.includes("o355-cookie-banner-fix"), "| fatal/parse error text present:", /fatal error|parse error/i.test(html));
}
main().catch(e => console.error("ERR", e.message));
