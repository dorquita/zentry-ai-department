require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function checkProduct(id, label) {
  const r = await fetch(`${base}/wp-json/wc/store/v1/products/${id}?nocache=${Date.now()}`);
  const p = await r.json();
  const hasCabinet = (p.variations || []).some((v) => v.attributes.some((a) => a.value === "Cabinet"));
  console.log(
    `${label} #${id}: purchasable=${p.is_purchasable} range=${JSON.stringify(p.prices?.price_range)} variations=${p.variations?.length} tieneCabinet=${hasCabinet}`
  );
}

async function main() {
  console.log("=== Muestra representativa (una de cada grupo) ===");
  await checkProduct(597, "Clase A");
  await checkProduct(1311, "Clase B/Melamina (caso obligatorio)");
  await checkProduct(1319, "Clase B/Melamina-Fenolico (con Espesor)");
  await checkProduct(372, "Clase C/Metalica");
  await checkProduct(489, "Fenolica bloqueada (Resbalón sigue con precio antiguo)");
  await checkProduct(334, "Caso especial 334 (sin cambios)");
  await checkProduct(1988, "Banco (fuera de alcance, sin cambios)");

  console.log("\n=== Carrito invitado: verificar Cabinet ya no es aceptado ===");
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce");
  const cookies = nonceRes.headers.get("set-cookie");
  const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
    body: JSON.stringify({ id: 1311, quantity: 1, variation: [{ attribute: "attribute_anchura", value: "30 cm" }, { attribute: "attribute_tipo-de-cerradura", value: "Resbalón" }] }),
  });
  const addJson = await addRes.json();
  console.log("Añadir Resbalón/30cm -> status:", addRes.status, "| precio:", addJson.items?.slice(-1)[0]?.totals?.line_total);

  const addResCabinet = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
    body: JSON.stringify({ id: 1311, quantity: 1, variation: [{ attribute: "attribute_anchura", value: "30 cm" }, { attribute: "attribute_tipo-de-cerradura", value: "Cabinet" }] }),
  });
  console.log("Intentar añadir Cabinet/30cm (debe fallar) -> status:", addResCabinet.status, (await addResCabinet.json()).message);

  console.log("\n=== Categoria y buscador ===");
  for (const url of [
    "/product-category/taquillas-metalicas/",
    "/product-category/taquillas-de-melamina/",
    "/?s=taquilla&post_type=product",
  ]) {
    const r = await fetch(`${base}${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`);
    const text = await r.text();
    const hasError = /fatal error|parse error/i.test(text);
    console.log(url, "-> HTTP", r.status, "| error PHP:", hasError);
  }
}

main().catch((e) => console.error("ERR", e.message));
