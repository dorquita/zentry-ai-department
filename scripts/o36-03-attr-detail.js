require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function get(env, id) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products/" + id, { headers: { Authorization: env.auth } });
  return await r.json();
}

async function main() {
  const id = 603;
  const [s, p] = await Promise.all([get(staging, id), get(prod, id)]);
  console.log("=== STAGING #" + id, "attributes ===");
  console.log(JSON.stringify(s.attributes, null, 2));
  console.log("\n=== PRODUCTION #" + id, "attributes ===");
  console.log(JSON.stringify(p.attributes, null, 2));

  console.log("\n=== STAGING images ===", s.images.map(i => i.src));
  console.log("=== PRODUCTION images ===", p.images.map(i => i.src));

  // variations
  const sv = await fetch(staging.base + "/wp-json/wc/v3/products/" + id + "/variations?per_page=100", { headers: { Authorization: staging.auth } }).then(r => r.json());
  const pv = await fetch(prod.base + "/wp-json/wc/v3/products/" + id + "/variations?per_page=100", { headers: { Authorization: prod.auth } }).then(r => r.json());
  console.log("\n=== STAGING variations count:", sv.length, "===");
  sv.forEach(v => console.log(" -", v.id, v.attributes.map(a=>a.option).join("/"), "price:", v.price));
  console.log("\n=== PRODUCTION variations count:", pv.length, "===");
  pv.forEach(v => console.log(" -", v.id, v.attributes.map(a=>a.option).join("/"), "price:", v.price));
}
main().catch(e => console.error("ERR", e.message));
