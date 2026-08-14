require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const r = await fetch(prod.base + "/wp-json/wc/v3/settings/account/woocommerce_enable_guest_checkout", {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ value: "yes" }),
  });
  const j = await r.json();
  console.log("guest checkout setting now:", j.value);
}
main().catch(e => console.error("ERR", e.message));
