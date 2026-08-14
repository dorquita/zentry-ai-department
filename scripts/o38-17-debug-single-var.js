require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // find the variation id for product 489, combo 40cm/resbalon
  const r = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations?per_page=100", { headers: { Authorization: prod.auth } });
  const vars = await r.json();
  const target = vars.find(v => v.attributes.some(a => a.option.toLowerCase().includes('resbal')) && v.attributes.some(a => a.option === '40 cm'));
  console.log("found variation:", target.id, "current regular_price:", target.regular_price);

  // try explicit single PUT with logging of full response
  const putR = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations/" + target.id, {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ regular_price: "471", price: "471" }),
  });
  const putJ = await putR.json();
  console.log("PUT status:", putR.status);
  console.log("PUT response regular_price:", putJ.regular_price, "| price:", putJ.price, "| error:", putJ.code || "none");

  // re-fetch immediately
  const checkR = await fetch(prod.base + "/wp-json/wc/v3/products/489/variations/" + target.id, { headers: { Authorization: prod.auth } });
  const checkJ = await checkR.json();
  console.log("RE-FETCH regular_price:", checkJ.regular_price, "| price:", checkJ.price);
}
main().catch(e => console.error("ERR", e.message));
