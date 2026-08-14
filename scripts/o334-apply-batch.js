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

function buildVarAttrs(anchura, espesor, cerraduraLabel) {
  const attrs = [{ id: 0, name: "Anchura", option: anchura }];
  if (espesor) attrs.push({ id: 11, name: "Espesor", option: espesor });
  attrs.push({ id: 0, name: "Tipo de cerradura", option: cerraduraLabel });
  return attrs;
}

async function processOp(op, baseLabel) {
  const summary = { id: op.id, name: op.name, renamed: 0, created: 0, errors: [] };

  for (const r of op.renameOps) {
    const attrs = buildVarAttrs(r.anchura, r.espesor, baseLabel);
    const res = await wc(`products/${op.id}/variations/${r.varId}`, "PUT", { attributes: attrs });
    if (res.status === 200) summary.renamed++;
    else summary.errors.push({ type: "rename", varId: r.varId, status: res.status, msg: res.json.message });
  }

  const prod = await wc(`products/${op.id}`, "GET");
  const attrs = prod.json.attributes.map((a) => (a.name === "Tipo de cerradura" ? { ...a, options: op.newOptions } : a));
  const putProd = await wc(`products/${op.id}`, "PUT", { attributes: attrs });
  if (putProd.status !== 200) summary.errors.push({ type: "productAttrs", status: putProd.status, msg: putProd.json.message });

  for (const nv of op.newVariations) {
    const attrs2 = buildVarAttrs(nv.anchura, nv.espesor, nv.cerradura);
    const res = await wc(`products/${op.id}/variations`, "POST", { regular_price: String(nv.price), attributes: attrs2 });
    if (res.status === 201) summary.created++;
    else summary.errors.push({ type: "create", variation: nv, status: res.status, msg: res.json.message });
  }

  return summary;
}

async function main() {
  const ops = JSON.parse(fs.readFileSync(path.join(__dirname, "o334-apply-ops.json"), "utf-8"));
  const alreadyDone = new Set([597]);

  const results = [];

  for (const op of ops.classA) {
    if (alreadyDone.has(op.id)) continue;
    const s = await processOp(op, "Cerradura de resbalón");
    results.push(s);
    console.log(JSON.stringify(s));
  }
  console.log("\n=== Clase A completa ===\n");

  for (const op of ops.classB) {
    const s = await processOp(op, "Cerradura de resbalón");
    results.push(s);
    console.log(JSON.stringify(s));
  }
  console.log("\n=== Clase B completa ===\n");

  for (const op of ops.classC) {
    const s = await processOp(op, "Cerradura de bombillo");
    results.push(s);
    console.log(JSON.stringify(s));
  }
  console.log("\n=== Clase C completa ===\n");

  const totalCreated = results.reduce((s, r) => s + r.created, 0);
  const totalRenamed = results.reduce((s, r) => s + r.renamed, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`\nRESUMEN: ${results.length} productos procesados | ${totalRenamed} renombrados | ${totalCreated} nuevas creadas | ${totalErrors} errores`);
  if (totalErrors > 0) {
    console.log("ERRORES:", JSON.stringify(results.filter((r) => r.errors.length > 0), null, 2));
  }
}

main().catch((e) => console.error("ERR", e.message));
