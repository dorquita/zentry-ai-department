require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function main() {
  const nonceRes = await fetch(`${base}/wp-json/wc/store/v1/cart`);
  const nonce = nonceRes.headers.get("nonce") || nonceRes.headers.get("x-wc-store-api-nonce");
  const cookies = nonceRes.headers.get("set-cookie");

  const cases = [
    { id: 597, varId: 599, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Resbalón" }, label: "Clase A - melamina 30cm/Resbalón" },
    { id: 1319, varId: 1321, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Resbalón", attribute_espesor: "10 mm" }, label: "Clase B - melamina-fenolico 30cm/10mm/Resbalón" },
    { id: 372, varId: 374, variation: { attribute_anchura: "30 cm", "attribute_tipo-de-cerradura": "Bombillo" }, label: "Clase C - metalica 30cm/Bombillo" },
  ];

  for (const c of cases) {
    const variationArr = Object.entries(c.variation).map(([attribute, value]) => ({ attribute, value }));
    const addRes = await fetch(`${base}/wp-json/wc/store/v1/cart/add-item`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Nonce: nonce, Cookie: cookies || "" },
      body: JSON.stringify({ id: c.id, quantity: 1, variation: variationArr }),
    });
    const addJson = await addRes.json();
    if (addRes.status >= 400) {
      console.log(c.label, "-> ERROR", addRes.status, addJson.message);
    } else {
      const lastItem = addJson.items?.slice(-1)[0];
      console.log(c.label, "-> OK", addRes.status, "| item:", lastItem?.name, "| precio:", lastItem?.totals?.line_total, "(minor unit", lastItem?.totals?.currency_minor_unit + ")");
    }
  }

  const cartRes = await fetch(`${base}/wp-json/wc/store/v1/cart`, { headers: { Cookie: cookies || "" } });
  const cart = await cartRes.json();
  console.log("\nCarrito final: items=", cart.items?.length, "| total=", cart.totals?.total_price, "(minor unit", cart.totals?.currency_minor_unit + ")");
  for (const it of cart.items || []) console.log("  -", it.name, "|", it.totals?.line_total, "| variation:", JSON.stringify(it.variation));
}

main().catch((e) => console.error("ERR", e.message));
