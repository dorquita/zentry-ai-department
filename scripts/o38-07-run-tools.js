require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function runTool(id) {
  const r = await fetch(prod.base + "/wp-json/wc/v3/system_status/tools/" + id, {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const j = await r.json();
  console.log(id, "-> status", r.status, "|", JSON.stringify(j).slice(0, 300));
}

async function main() {
  await runTool("clear_transients");
  await runTool("regenerate_product_lookup_tables");
}
main().catch(e => console.error("ERR", e.message));
