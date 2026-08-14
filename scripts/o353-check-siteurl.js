require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/", { headers: { Authorization: auth } });
  const j = await r.json();
  console.log("root url:", j.url);
  console.log("home:", j.home);

  const r2 = await fetch(base + "/wp-json/wp/v2/pages/254?_fields=id,slug,link", { headers: { Authorization: auth } });
  const p = await r2.json();
  console.log("page 254 link (from REST):", p.link);
}
main().catch(e => console.error("ERR", e.message));
