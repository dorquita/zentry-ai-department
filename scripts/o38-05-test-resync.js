require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const before = await fetch(prod.base + "/wp-json/wc/v3/products/339", { headers: { Authorization: prod.auth } }).then(r => r.json());
  console.log("BEFORE price_html:", before.price_html);

  // no-op resave: PUT with the same regular_price it already has (variable products ignore this but it forces save())
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/339", {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ regular_price: before.regular_price }),
  });
  const after1 = await r.json();
  console.log("AFTER resave price_html:", after1.price_html);

  // re-fetch fresh to be sure
  const after2 = await fetch(prod.base + "/wp-json/wc/v3/products/339", { headers: { Authorization: prod.auth } }).then(r => r.json());
  console.log("RE-FETCH price_html:", after2.price_html, "| price:", after2.price);
}
main().catch(e => console.error("ERR", e.message));
