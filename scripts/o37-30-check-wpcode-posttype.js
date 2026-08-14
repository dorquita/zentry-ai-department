require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  for (const slug of ["wpcode", "wpcode_snippet", "snippet"]) {
    const r = await fetch(prod.base + "/wp-json/wp/v2/" + slug, { headers: { Authorization: prod.auth } });
    console.log(slug, "-> status", r.status);
    if (r.status === 200) {
      const j = await r.json();
      console.log(JSON.stringify(j).slice(0, 500));
    }
  }
}
main().catch(e => console.error("ERR", e.message));
