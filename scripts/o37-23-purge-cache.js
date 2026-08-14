require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // LiteSpeed cache purge-all endpoint (if exposed) - try common LSCache REST route
  const r = await fetch(prod.base + "/wp-json/litespeed/v1/purge?type=all", { method: "POST", headers: { Authorization: prod.auth } });
  console.log("litespeed purge attempt status:", r.status);
  console.log(await r.text());
}
main().catch(e => console.error("ERR", e.message));
