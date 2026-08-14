require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function wc(path, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function main() {
  const id = 1319; // Taquilla 1 puerta - Modulo 1 (Melamina-Fenolico)
  const var30 = 1321; // currently 30cm/Resbalon, price 199
  const var40 = 1323; // currently 40cm/Resbalon, price 255

  // 1. Add Espesor attribute to product, keep existing attrs untouched
  const prod = await wc(`products/${id}`, "GET");
  const attrs = [...prod.json.attributes, { id: 11, name: "Espesor", options: ["10 mm", "12 mm"], variation: true, visible: true }];
  const putProd = await wc(`products/${id}`, "PUT", { attributes: attrs });
  console.log("Product attr update:", putProd.status, JSON.stringify(putProd.json.attributes?.map((a) => a.name)));

  // 2. Reuse var30 -> 30cm/Resbalon/10mm, price 322
  const up30 = await wc(`products/${id}/variations/${var30}`, "PUT", {
    regular_price: "322",
    sale_price: "",
    attributes: [
      { id: 0, name: "Anchura", option: "30 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
      { id: 11, name: "Espesor", option: "10 mm" },
    ],
  });
  console.log("var30 -> 10mm:", up30.status, JSON.stringify(up30.json.attributes), up30.json.price);

  // 3. Reuse var40 -> 40cm/Resbalon/10mm, price 351
  const up40 = await wc(`products/${id}/variations/${var40}`, "PUT", {
    regular_price: "351",
    sale_price: "",
    attributes: [
      { id: 0, name: "Anchura", option: "40 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
      { id: 11, name: "Espesor", option: "10 mm" },
    ],
  });
  console.log("var40 -> 10mm:", up40.status, JSON.stringify(up40.json.attributes), up40.json.price);

  // 4. Create new variation 30cm/Resbalon/12mm, price 333
  const new30 = await wc(`products/${id}/variations`, "POST", {
    regular_price: "333",
    attributes: [
      { id: 0, name: "Anchura", option: "30 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
      { id: 11, name: "Espesor", option: "12 mm" },
    ],
  });
  console.log("new 30cm/12mm:", new30.status, new30.json.id, new30.json.price);

  // 5. Create new variation 40cm/Resbalon/12mm, price 366
  const new40 = await wc(`products/${id}/variations`, "POST", {
    regular_price: "366",
    attributes: [
      { id: 0, name: "Anchura", option: "40 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
      { id: 11, name: "Espesor", option: "12 mm" },
    ],
  });
  console.log("new 40cm/12mm:", new40.status, new40.json.id, new40.json.price);

  // 6. Verify final variation list
  const finalVars = await wc(`products/${id}/variations?per_page=20`, "GET");
  console.log("\nFinal variations:");
  for (const v of finalVars.json) {
    console.log(" ", v.id, v.price, JSON.stringify(v.attributes.map((a) => a.option)));
  }
}

main().catch((e) => console.error("ERR", e.message));
