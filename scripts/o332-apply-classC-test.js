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
  const id = 372; // Taquilla 2 puertas - Modulo 1 (Metalica)
  const var30 = 374; // currently 30cm/Resbalon
  const var40 = 376; // currently 40cm/Resbalon
  const price30 = 257;
  const price40 = 273;

  // 1. Product attribute: replace "Resbalon" with "Bombillo" in Tipo de cerradura options (Cabinet stays, still blocked)
  const prod = await wc(`products/${id}`, "GET");
  const attrs = prod.json.attributes.map((a) => {
    if (a.name === "Tipo de cerradura") return { ...a, options: a.options.map((o) => (o === "Resbalón" ? "Bombillo" : o)) };
    return a;
  });
  const putProd = await wc(`products/${id}`, "PUT", { attributes: attrs });
  console.log("Product attr update:", putProd.status, JSON.stringify(putProd.json.attributes?.find((a) => a.name === "Tipo de cerradura")?.options));

  // 2. Repurpose the two Resbalon variations into Bombillo, with correct base tariff price
  const up30 = await wc(`products/${id}/variations/${var30}`, "PUT", {
    regular_price: String(price30),
    sale_price: "",
    attributes: [
      { id: 0, name: "Anchura", option: "30 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Bombillo" },
    ],
  });
  const up40 = await wc(`products/${id}/variations/${var40}`, "PUT", {
    regular_price: String(price40),
    sale_price: "",
    attributes: [
      { id: 0, name: "Anchura", option: "40 cm" },
      { id: 0, name: "Tipo de cerradura", option: "Bombillo" },
    ],
  });
  console.log("var30 -> Bombillo:", up30.status, JSON.stringify(up30.json.attributes), up30.json.price);
  console.log("var40 -> Bombillo:", up40.status, JSON.stringify(up40.json.attributes), up40.json.price);

  const finalVars = await wc(`products/${id}/variations?per_page=20`, "GET");
  console.log("\nFinal variations:");
  for (const v of finalVars.json) console.log(" ", v.id, v.price, JSON.stringify(v.attributes.map((a) => a.option)));
}

main().catch((e) => console.error("ERR", e.message));
