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
  const productId = 597; // Clase A test product
  const cabinetVarId = 598; // 30cm/Cabinet, price 199

  // 1. Set variation status to private (non-destructive hide)
  const put = await wc(`products/${productId}/variations/${cabinetVarId}`, "PUT", { status: "private" });
  console.log("PUT status:private ->", put.status, JSON.stringify({ id: put.json.id, status: put.json.status }));

  // 2. Also remove Cabinet from the product's visible attribute options
  const prod = await wc(`products/${productId}`, "GET");
  const attrs = prod.json.attributes.map((a) => {
    if (a.name === "Tipo de cerradura") return { ...a, options: a.options.filter((o) => o !== "Cabinet") };
    return a;
  });
  const putProd = await wc(`products/${productId}`, "PUT", { attributes: attrs });
  console.log(
    "Product attrs update ->",
    putProd.status,
    JSON.stringify(putProd.json.attributes?.find((a) => a.name === "Tipo de cerradura")?.options)
  );

  // 3. Verify via guest Store API: is_purchasable, price_range, variations list
  await new Promise((r) => setTimeout(r, 500));
  const storeRes = await fetch(`${base}/wp-json/wc/store/v1/products/${productId}?nocache=${Date.now()}`);
  const storeJson = await storeRes.json();
  console.log("\nStore API (invitado):");
  console.log(" is_purchasable:", storeJson.is_purchasable);
  console.log(" price_range:", JSON.stringify(storeJson.prices?.price_range));
  console.log(" variations visibles:", storeJson.variations?.length);
  for (const v of storeJson.variations || []) console.log("  ", v.id, JSON.stringify(v.attributes));
}

main().catch((e) => console.error("ERR", e.message));
