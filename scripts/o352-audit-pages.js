require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const r = await fetch(base + "/wp-json/wp/v2/pages?per_page=100&status=publish,draft,private&_fields=id,slug,title,link,status", { headers: { Authorization: auth } });
  const pages = await r.json();
  console.log("TOTAL PAGES:", pages.length);
  for (const p of pages) {
    console.log(p.id, "|", p.status, "|", p.slug, "|", p.title.rendered, "|", p.link);
  }
}
main().catch(e => console.error("ERR", e.message));
