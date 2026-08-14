require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // find a real (non-stale, correctly priced) variation of product 339 and re-PUT it as a no-op to force sync
  const vr = await fetch(prod.base + "/wp-json/wc/v3/products/339/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const vars = await vr.json();
  console.log("variation count now:", vars.length);
  const target = vars[0];
  console.log("touching variation", target.id, "current regular_price:", target.regular_price);

  const r = await fetch(prod.base + "/wp-json/wc/v3/products/339/variations/" + target.id, {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ regular_price: target.regular_price }),
  });
  const j = await r.json();
  console.log("touch result status:", r.status, "| regular_price now:", j.regular_price);

  const p = await fetch(prod.base + "/wp-json/wc/v3/products/339", { headers: { Authorization: prod.auth } }).then(r=>r.json());
  console.log("parent price after touch:", p.price);
}
main().catch(e => console.error("ERR", e.message));
