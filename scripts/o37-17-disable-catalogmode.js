require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wp/v2/plugins/elex-woocommerce-catalog-mode/elex-catalog-mode", {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "inactive" }),
  });
  const j = await r.json();
  console.log("STATUS", r.status);
  console.log("plugin status now:", j.status);
}
main().catch(e => console.error("ERR", e.message));
