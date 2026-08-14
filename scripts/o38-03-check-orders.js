require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const data = JSON.parse(require("fs").readFileSync("/opt/zentry-ai-department/reports/o37-stale-variations.json", "utf8"));
  const allIds = [];
  data.forEach(r => r.stale.forEach(s => allIds.push({ productId: r.productId, variationId: s.id })));
  console.log("total to check:", allIds.length);

  // Check each variation's total_sales via WC API (proxy for "ever ordered")
  let withSales = [];
  for (const { productId, variationId } of allIds) {
    const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + productId + "/variations/" + variationId, { headers: { Authorization: prod.auth } });
    if (r.status !== 200) { console.log("WARN could not fetch", productId, variationId, "status", r.status); continue; }
    // variations don't have total_sales field directly in v3, but we can check via orders search referencing this variation - skip heavy search, use menu_order/date as proxy is unreliable.
  }

  // Better: search orders that reference any of these variation IDs via line items - WC REST doesn't support direct filter by variation_id, so fetch recent orders and cross-check (bounded, catalog is new/low volume)
  const ordersR = await fetch(prod.base + "/wp-json/wc/v3/orders?per_page=100&status=any", { headers: { Authorization: prod.auth } });
  const orders = await ordersR.json();
  console.log("total orders on production:", Array.isArray(orders) ? orders.length : "ERROR " + JSON.stringify(orders).slice(0,200));

  const staleIdSet = new Set(allIds.map(x => x.variationId));
  const affectedOrders = [];
  if (Array.isArray(orders)) {
    for (const o of orders) {
      for (const li of (o.line_items || [])) {
        if (staleIdSet.has(li.variation_id)) {
          affectedOrders.push({ orderId: o.id, status: o.status, variationId: li.variation_id });
        }
      }
    }
  }
  console.log("orders referencing any stale variation:", affectedOrders.length);
  if (affectedOrders.length) console.log(JSON.stringify(affectedOrders, null, 2));
}
main().catch(e => console.error("ERR", e.message));
