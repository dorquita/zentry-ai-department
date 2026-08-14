require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function checkProduct(id, label) {
  const r = await fetch(`${base}/wp-json/wc/store/v1/products/${id}?nocache=${Date.now()}`);
  const p = await r.json();
  const priceNull = p.prices && (p.prices.price === null || p.prices.price === undefined);
  console.log(
    `${label} #${id}: purchasable=${p.is_purchasable} price_null=${priceNull} range=${JSON.stringify(p.prices?.price_range)} variations=${p.variations?.length ?? "n/a"}`
  );
  return p;
}

async function main() {
  console.log("=== Clase A (melamina puerta-melamina) ===");
  await checkProduct(597, "A");
  await checkProduct(1311, "A");

  console.log("\n=== Clase B (melamina-fenolico, con Espesor) ===");
  const b1 = await checkProduct(1319, "B");
  await checkProduct(1373, "B");
  console.log("  variaciones detalladas #1319:");
  for (const v of b1.variations || []) console.log("   ", v.id, JSON.stringify(v.attributes));

  console.log("\n=== Clase C (metalicas, Bombillo) ===");
  const c1 = await checkProduct(372, "C");
  await checkProduct(435, "C");
  console.log("  variaciones detalladas #372:");
  for (const v of c1.variations || []) console.log("   ", v.id, JSON.stringify(v.attributes));

  console.log("\n=== Bloqueados (sin cambios, deben seguir en placeholder) ===");
  await checkProduct(489, "Fenolica-bloqueada");
  await checkProduct(334, "Metalica-especial-bloqueada");

  console.log("\n=== Bancos (fuera de alcance, no tocados) ===");
  await checkProduct(1988, "Banco");

  console.log("\n=== Carrito como invitado: producto Clase A ===");
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce") || nonceRes.headers.get("x-wc-store-api-nonce");
  const cookies = nonceRes.headers.get("set-cookie");
  console.log("nonce presente:", !!nonce, "| cookie presente:", !!cookies);

  const variantsRes = await fetch(`${base}/wp-json/wc/store/v1/products/597?nocache=${Date.now()}`);
  const variantsJson = await variantsRes.json();
  const firstVar = variantsJson.variations?.[0];
  console.log("primera variacion a probar:", firstVar?.id);

  if (nonce && firstVar) {
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: 597, quantity: 1, variation: [{ attribute: "attribute_anchura", value: firstVar.attributes[0]?.value }] }),
    });
    console.log("add-item status:", addRes.status);
    const addJson = await addRes.json();
    console.log("carrito items:", addJson.items?.length, "| total:", addJson.totals?.total_price);
  }
}

main().catch((e) => console.error("ERR", e.message));
