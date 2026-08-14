require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function checkoutSettings(env, label) {
  const r = await fetch(env.base + "/wp-json/wc/v3/settings/account", { headers: { Authorization: env.auth } });
  const j = await r.json();
  const guest = j.find(s => s.id === "woocommerce_enable_guest_checkout");
  console.log(label, "guest checkout:", guest ? guest.value : "not found");
}

async function paymentGateways(env, label) {
  const r = await fetch(env.base + "/wp-json/wc/v3/payment_gateways", { headers: { Authorization: env.auth } });
  const j = await r.json();
  console.log(label, "payment gateways:");
  for (const g of j) {
    if (g.enabled) {
      const testMode = (g.settings && g.settings.test_mode) ? g.settings.test_mode.value : undefined;
      console.log("  -", g.id, "| title:", g.title, "| enabled:", g.enabled, testMode !== undefined ? ("| test_mode: " + testMode) : "");
    }
  }
}

async function main() {
  await checkoutSettings(staging, "STAGING");
  await checkoutSettings(prod, "PRODUCTION");
  console.log("");
  await paymentGateways(staging, "STAGING");
  console.log("");
  await paymentGateways(prod, "PRODUCTION");
}
main().catch(e => console.error("ERR", e.message));
