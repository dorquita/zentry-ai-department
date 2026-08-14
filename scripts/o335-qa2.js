require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function checkProduct(id, label) {
  const r = await fetch(`${base}/wp-json/wc/store/v1/products/${id}?nocache=${Date.now()}`);
  const p = await r.json();
  console.log(`${label} #${id}: purchasable=${p.is_purchasable} range=${JSON.stringify(p.prices?.price_range)} variations=${p.variations?.length}`);
  return p;
}

async function main() {
  console.log("=== CASO 1: Fenólica con perfilería (489) ===");
  const c1 = await checkProduct(489, "Fenólica M1-1P");
  const cerraduras1 = [...new Set(c1.variations.map((v) => v.attributes.find((a) => a.name === "Tipo de cerradura")?.value))];
  console.log("  cerraduras:", cerraduras1.join(", "));
  console.log("  Bombillo presente (debe ser false):", cerraduras1.some((c) => c.toLowerCase().includes("bombillo")));
  console.log("  Cabinet presente (debe ser false):", cerraduras1.some((c) => c === "Cabinet"));

  console.log("\n=== CASO 2: Producto 334 ===");
  const c2 = await checkProduct(334, "Metálica 1P-M1 (334)");
  console.log("  30cm=194€:", c2.variations.some((v) => v.attributes.some((a) => a.value === "30cm") && v.price === "19400"));
  console.log("  40cm=239€:", c2.variations.some((v) => v.attributes.some((a) => a.value === "40cm") && v.price === "23900"));
  console.log("  Total variaciones visibles (debe ser 2):", c2.variations.length);

  console.log("\n=== CASO 3: Categorías corregidas (muestra) ===");
  for (const id of [1261, 573]) {
    const r = await fetch(`${base}/wp-json/wc/store/v1/products/${id}`);
    const p = await r.json();
    console.log(` #${id} categorias:`, p.categories.map((c) => c.name).join(", "));
  }

  console.log("\n=== Carrito invitado ===");
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce");
  const cookies = nonceRes.headers.get("set-cookie");

  const cartCases = [
    { id: 489, variation: { attribute_anchura: "30 cm", attribute_pa_espesor: "10-mm", "attribute_tipo-de-cerradura": "ARES electrónica" }, label: "Fenólica + ARES + 10mm" },
    { id: 334, variation: { attribute_anchura: "30cm", "attribute_tipo-de-cerradura": "Cerradura de bombillo" }, label: "334 + Bombillo 30cm" },
  ];
  for (const c of cartCases) {
    const variationArr = Object.entries(c.variation).map(([attribute, value]) => ({ attribute, value }));
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: c.id, quantity: 1, variation: variationArr }),
    });
    const addJson = await addRes.json();
    if (addRes.status >= 400) console.log(c.label, "-> ERROR", addRes.status, addJson.message);
    else console.log(c.label, "-> OK", addRes.status, "| precio:", addJson.items?.slice(-1)[0]?.totals?.line_total);
  }

  console.log("\n=== Combinaciones prohibidas (deben fallar) ===");
  const forbidden = [
    { id: 489, variation: { attribute_anchura: "30 cm", attribute_pa_espesor: "10-mm", "attribute_tipo-de-cerradura": "Cabinet" }, label: "Fenólica + Cabinet" },
    { id: 334, variation: { attribute_anchura: "30cm", "attribute_tipo-de-cerradura": "Ares" }, label: "334 + Ares (privatizada)" },
  ];
  for (const c of forbidden) {
    const variationArr = Object.entries(c.variation).map(([attribute, value]) => ({ attribute, value }));
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: c.id, quantity: 1, variation: variationArr }),
    });
    console.log(c.label, "-> status", addRes.status, addRes.status >= 400 ? "(correctamente rechazado)" : "(!!! DEBERIA FALLAR)");
  }

  console.log("\n=== Categoria, buscador ===");
  for (const url of ["/product-category/taquillas-fenolicas/", "/?s=taquilla&post_type=product"]) {
    const r = await fetch(`${base}${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`);
    const text = await r.text();
    console.log(url, "-> HTTP", r.status, "| error PHP:", /fatal error|parse error/i.test(text));
  }
}

main().catch((e) => console.error("ERR", e.message));
