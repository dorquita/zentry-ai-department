require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const rs = await fetch(staging.base + "/wp-json/wc/v3/products/334/variations?per_page=100", { headers: { Authorization: staging.auth } });
  const svars = await rs.json();
  console.log("staging product 334 total variations:", svars.length);

  const rp = await fetch(prod.base + "/wp-json/wc/v3/products/334/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const pvars = await rp.json();
  console.log("production product 334 total variations:", pvars.length);

  // check for orders referencing product 334 variations
  const ordersR = await fetch(prod.base + "/wp-json/wc/v3/orders?per_page=100&status=any", { headers: { Authorization: prod.auth } });
  const orders = await ordersR.json();
  console.log("total production orders:", Array.isArray(orders) ? orders.length : JSON.stringify(orders).slice(0,200));
}
main().catch(e => console.error("ERR", e.message));
