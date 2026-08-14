require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: prod.auth } });
  const list = await r.json();
  for (const s of list) {
    const code = s.code || "";
    if (/get_price_html|woocommerce_get_price_html|price_html|catalog_mode|hide.*price|is_user_logged_in.*price/i.test(code)) {
      console.log("MATCH:", s.id, s.name);
      console.log(code.slice(0, 800));
      console.log("---");
    }
  }
  console.log("done scanning", list.length, "snippets");
}
main().catch(e => console.error("ERR", e.message));
