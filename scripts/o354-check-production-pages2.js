require("dotenv").config();
const prodBase = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  console.log("PRODUCTION BASE:", prodBase);
  for (const slug of ["cookies", "privacidad", "aviso-legal"]) {
    const r = await fetch(prodBase + "/wp-json/wp/v2/pages?slug=" + slug + "&_fields=id,slug,title,link,status");
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length > 0) {
      const p = arr[0];
      console.log("FOUND", slug, "-> id", p.id, "| status", p.status, "| title", p.title.rendered, "| link", p.link);
    } else {
      console.log("NOT FOUND (public listing empty):", slug, "raw:", JSON.stringify(arr).slice(0,200));
    }
  }
}
main().catch(e => console.error("ERR", e.message));
