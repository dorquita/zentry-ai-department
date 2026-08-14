require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  // check if it already exists on production (maybe under different slug)
  const existR = await fetch(prod.base + "/wp-json/wc/v3/products/attributes?per_page=100", { headers: { Authorization: prod.auth } });
  const existing = await existR.json();
  let attr = existing.find(a => a.slug === "pa_espesor");
  if (attr) {
    console.log("already exists:", JSON.stringify(attr));
  } else {
    const r = await fetch(prod.base + "/wp-json/wc/v3/products/attributes", {
      method: "POST",
      headers: { Authorization: prod.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Espesor", slug: "espesor", type: "select", order_by: "menu_order", has_archives: false }),
    });
    attr = await r.json();
    console.log("created attribute:", JSON.stringify(attr));
  }

  // create terms 10mm/12mm
  const termsR = await fetch(prod.base + "/wp-json/wc/v3/products/attributes/" + attr.id + "/terms?per_page=100", { headers: { Authorization: prod.auth } });
  const existingTerms = await termsR.json();
  const wanted = [{ name: "10 mm", slug: "10-mm" }, { name: "12 mm", slug: "12-mm" }];
  const result = [];
  for (const w of wanted) {
    let t = existingTerms.find(x => x.slug === w.slug);
    if (!t) {
      const cr = await fetch(prod.base + "/wp-json/wc/v3/products/attributes/" + attr.id + "/terms", {
        method: "POST",
        headers: { Authorization: prod.auth, "Content-Type": "application/json" },
        body: JSON.stringify(w),
      });
      t = await cr.json();
      console.log("created term:", JSON.stringify({id:t.id,name:t.name,slug:t.slug}));
    } else {
      console.log("term already exists:", JSON.stringify({id:t.id,name:t.name,slug:t.slug}));
    }
    result.push(t);
  }
  console.log("\nFINAL attribute id on production:", attr.id, "| slug:", attr.slug);
}
main().catch(e => console.error("ERR", e.message));
