require("dotenv").config();
const fs = require("fs");
const path = require("path");

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function wc(p, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${p}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

function buildVarAttrs(op, anchura, espesor, cerraduraLabel) {
  const attrs = [{ id: 0, name: "Anchura", option: anchura }];
  if (espesor) attrs.push({ id: 11, name: "Espesor", option: espesor });
  attrs.push({ id: 0, name: "Tipo de cerradura", option: cerraduraLabel });
  return attrs;
}

async function processOp(op, baseLabel) {
  console.log(`\n--- Producto ${op.id}: ${op.name} ---`);

  // 1. Rename base variations
  for (const r of op.renameOps) {
    const attrs = buildVarAttrs(op, r.anchura, r.espesor, baseLabel);
    const res = await wc(`products/${op.id}/variations/${r.varId}`, "PUT", { attributes: attrs });
    console.log(`  rename var ${r.varId} -> ${res.status}`, JSON.stringify(res.json.attributes?.map((a) => a.option)));
  }

  // 2. Update product attribute options
  const prod = await wc(`products/${op.id}`, "GET");
  const attrs = prod.json.attributes.map((a) => {
    if (a.name === "Tipo de cerradura") return { ...a, options: op.newOptions };
    return a;
  });
  const putProd = await wc(`products/${op.id}`, "PUT", { attributes: attrs });
  console.log(`  producto attrs -> ${putProd.status}`, JSON.stringify(putProd.json.attributes?.find((a) => a.name === "Tipo de cerradura")?.options));

  // 3. Create new variations
  let created = 0;
  for (const nv of op.newVariations) {
    const attrs2 = buildVarAttrs(op, nv.anchura, nv.espesor, nv.cerradura);
    const res = await wc(`products/${op.id}/variations`, "POST", { regular_price: String(nv.price), attributes: attrs2 });
    if (res.status === 201) created++;
    else console.log(`  ERROR creando variacion:`, JSON.stringify(nv), res.status, JSON.stringify(res.json));
  }
  console.log(`  ${created}/${op.newVariations.length} variaciones nuevas creadas`);
  return created;
}

async function main() {
  const ops = JSON.parse(fs.readFileSync(path.join(__dirname, "o334-apply-ops.json"), "utf-8"));
  const testOp = ops.classA.find((o) => o.id === 597);
  await processOp(testOp, "Cerradura de resbalón");

  // Verify via guest store API
  const r = await fetch(`${base}/wp-json/wc/store/v1/products/597?nocache=${Date.now()}`);
  const j = await r.json();
  console.log("\nVerificacion Store API: variations=", j.variations?.length, "range=", JSON.stringify(j.prices?.price_range));
  for (const v of j.variations || []) console.log(" ", v.id, JSON.stringify(v.attributes));
}

main().catch((e) => console.error("ERR", e.message));
