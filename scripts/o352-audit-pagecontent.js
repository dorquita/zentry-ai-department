require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  for (const id of [254, 251, 256]) {
    const r = await fetch(base + "/wp-json/wp/v2/pages/" + id + "?_fields=id,slug,title,content,status", { headers: { Authorization: auth } });
    const p = await r.json();
    const raw = p.content.raw || p.content.rendered || "";
    console.log("=== ID", id, p.slug, "===");
    console.log("len:", raw.length);
    console.log(raw.slice(0, 400));
    console.log("");
  }
}
main().catch(e => console.error("ERR", e.message));
