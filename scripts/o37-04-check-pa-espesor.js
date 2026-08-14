require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

async function main() {
  const r = await fetch(staging.base + "/wp-json/wc/v3/products/attributes?per_page=100", { headers: { Authorization: staging.auth } });
  const attrs = await r.json();
  const pa = attrs.find(a => a.slug === "pa_espesor" || a.slug === "espesor");
  console.log("attribute:", JSON.stringify(pa, null, 2));
  if (pa) {
    const tr = await fetch(staging.base + "/wp-json/wc/v3/products/attributes/" + pa.id + "/terms?per_page=100", { headers: { Authorization: staging.auth } });
    const terms = await tr.json();
    console.log("terms:", JSON.stringify(terms.map(t => ({id:t.id, name:t.name, slug:t.slug})), null, 2));
  }

  // which products use it
  const raw = require("fs").readFileSync("/opt/zentry-ai-department/reports/o36-catalog-staging-full.json", "utf8");
  const products = JSON.parse(raw);
  const usingEspesor = products.filter(p => p.attributes.some(a => a.toLowerCase().startsWith("espesor")));
  console.log("\nproducts using espesor attribute:", usingEspesor.length);
  usingEspesor.forEach(p => console.log(" -", p.id, p.name));
}
main().catch(e => console.error("ERR", e.message));
