require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: prod.auth } });
  const list = await r.json();
  for (const s of list) {
    if (/cta|cross|presupuesto|cerradura/i.test(s.name)) {
      console.log(s.id, "|", s.active, "|", s.name);
    }
  }

  // also check WPCode Lite (insert-headers-and-footers) - different snippet manager
  const r2 = await fetch(prod.base + "/wp-json/wp/v2/plugins/insert-headers-and-footers/ihaf", { headers: { Authorization: prod.auth } });
  console.log("\nWPCode Lite status:", r2.status === 200 ? (await r2.json()).status : r2.status);
}
main().catch(e => console.error("ERR", e.message));
