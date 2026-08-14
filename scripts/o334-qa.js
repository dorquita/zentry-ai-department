require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function checkProduct(id, label) {
  const r = await fetch(`${base}/wp-json/wc/store/v1/products/${id}?nocache=${Date.now()}`);
  const p = await r.json();
  const cerraduras = [...new Set((p.variations || []).map((v) => v.attributes.find((a) => a.name === "Tipo de cerradura")?.value))];
  console.log(`${label} #${id}: purchasable=${p.is_purchasable} range=${JSON.stringify(p.prices?.price_range)} variations=${p.variations?.length}`);
  console.log("  cerraduras visibles:", cerraduras.join(", "));
  return { p, cerraduras };
}

async function main() {
  console.log("=== CASO OBLIGATORIO 1: Taquilla melamina (ID 1311) ===");
  const c1 = await checkProduct(1311, "Melamina 4P Modulo2");
  console.log("  Bombillo presente (debe ser false):", c1.cerraduras.some((c) => c.includes("bombillo")));
  console.log("  Cabinet presente (debe ser false):", c1.cerraduras.some((c) => c === "Cabinet"));
  console.log(
    "  Resbalón/Moneda/Candado/ARES/ORBIS/BOXIS/NEO todos presentes:",
    ["resbalón", "moneda", "candado", "ares", "orbis", "boxis", "neo"].every((k) => c1.cerraduras.some((c) => c.toLowerCase().includes(k)))
  );

  console.log("\n=== CASO OBLIGATORIO 2: Taquilla metálica (ID 435) ===");
  const c2 = await checkProduct(435, "Metalica 4P Modulo3");
  console.log("  Resbalón presente (debe ser false):", c2.cerraduras.some((c) => c.toLowerCase().includes("resbalón")));
  console.log("  Candado presente (debe ser false):", c2.cerraduras.some((c) => c.toLowerCase().includes("candado")));
  console.log("  Cabinet presente (debe ser false):", c2.cerraduras.some((c) => c === "Cabinet"));
  console.log(
    "  Bombillo/Moneda/ARES/ORBIS/BOXIS/NEO todos presentes:",
    ["bombillo", "moneda", "ares", "orbis", "boxis", "neo"].every((k) => c2.cerraduras.some((c) => c.toLowerCase().includes(k)))
  );

  console.log("\n=== Muestra Clase B (con Espesor) ===");
  await checkProduct(1319, "Melamina-Fenolico 1P Modulo1");

  console.log("\n=== Carrito invitado: comprar cada tipo nuevo ===");
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce");
  const cookies = nonceRes.headers.get("set-cookie");

  const cartCases = [
    { id: 1311, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "ARES electrónica" }, label: "Melamina + ARES electrónica" },
    { id: 435, variation: { attribute_anchura: "40 cm", "attribute_tipo-de-cerradura": "Cerradura de moneda" }, label: "Metálica + Cerradura de moneda" },
    { id: 1319, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Cerradura candado", attribute_pa_espesor: "10-mm" }, label: "Melamina-Fenólico + Candado + 10mm" },
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
    else {
      const item = addJson.items?.slice(-1)[0];
      console.log(c.label, "-> OK", addRes.status, "| precio:", item?.totals?.line_total, "| variation:", JSON.stringify(item?.variation));
    }
  }

  console.log("\n=== Intentar combinaciones PROHIBIDAS (deben fallar) ===");
  const forbidden = [
    { id: 1311, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Cerradura de bombillo" }, label: "Melamina + Bombillo (prohibido)" },
    { id: 435, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Cerradura de resbalón" }, label: "Metálica + Resbalón (prohibido)" },
    { id: 435, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Cerradura candado" }, label: "Metálica + Candado (prohibido)" },
    { id: 1311, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Cabinet" }, label: "Melamina + Cabinet (prohibido)" },
  ];
  for (const c of forbidden) {
    const variationArr = Object.entries(c.variation).map(([attribute, value]) => ({ attribute, value }));
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: c.id, quantity: 1, variation: variationArr }),
    });
    const addJson = await addRes.json();
    console.log(c.label, "-> status", addRes.status, addRes.status >= 400 ? "(correctamente rechazado)" : "(!!! DEBERIA HABER FALLADO)", addJson.message || "");
  }

  console.log("\n=== Categoria y buscador ===");
  for (const url of ["/product-category/taquillas-metalicas/", "/product-category/taquillas-de-melamina/", "/?s=taquilla&post_type=product"]) {
    const r = await fetch(`${base}${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`);
    const text = await r.text();
    console.log(url, "-> HTTP", r.status, "| error PHP:", /fatal error|parse error/i.test(text));
  }
}

main().catch((e) => console.error("ERR", e.message));
