require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function main() {
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce") || nonceRes.headers.get("x-wc-store-api-nonce");
  const cookies = nonceRes.headers.get("set-cookie");

  const cases = [
    { id: 597, varId: 599, label: "Clase A - melamina 30cm/Resbalón" },
    { id: 1319, varId: 1321, label: "Clase B - melamina-fenolico 30cm/10mm/Resbalón" },
    { id: 372, varId: 374, label: "Clase C - metalica 30cm/Bombillo" },
  ];

  for (const c of cases) {
    const varRes = await fetch(`${base}/wp-json/wc/store/v1/products/${c.id}?nocache=${Date.now()}`);
    const varJson = await varRes.json();
    const v = varJson.variations.find((x) => x.id === c.varId);
    const attrPayload = {};
    for (const a of v.attributes) {
      attrPayload[`attribute_${a.name.toLowerCase().replace(/\s+/g, "-").replace(/[áéíóúñ]/g, (m) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u", ñ: "n" }[m]))}`] = a.value;
    }
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: c.id, quantity: 1, variation_id: c.varId }),
    });
    const addJson = await addRes.json();
    console.log(c.label, "-> status:", addRes.status, "| items en carrito:", addJson.items_count ?? addJson.item_count ?? (addJson.code ? addJson.message : "?"), "| precio linea:", addJson.items?.slice(-1)[0]?.totals?.line_total);
  }

  const cartRes = await fetch(`${base}/wp-json/wc/store/v1/cart`, { headers: { Cookie: cookies || "" } });
  const cart = await cartRes.json();
  console.log("\nCarrito final: items=", cart.items?.length, "| total=", cart.totals?.total_price, "| currency minor unit=", cart.totals?.currency_minor_unit);
  for (const it of cart.items || []) console.log("  -", it.name, "|", it.totals?.line_total);
}

main().catch((e) => console.error("ERR", e.message));
