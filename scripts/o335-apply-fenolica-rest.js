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

function attrs(anchura, espesor, cerradura) {
  const a = [{ id: 0, name: "Anchura", option: anchura }];
  if (espesor) a.push({ id: 11, name: "Espesor", option: espesor });
  a.push({ id: 0, name: "Tipo de cerradura", option: cerradura });
  return a;
}

const BASE_LABEL = "Cerradura de resbalón";
const ALL_OPTIONS = [BASE_LABEL, "Cerradura de moneda", "Cerradura candado", "ARES electrónica", "ORBIS electrónica", "BOXIS electrónica", "NEO electrónica"];

async function processOp(op) {
  const summary = { id: op.id, name: op.name, renamed: 0, created: 0, errors: [] };

  for (const r of op.rename10mm) {
    const res = await wc(`products/${op.id}/variations/${r.varId}`, "PUT", {
      regular_price: String(r.price),
      sale_price: "",
      attributes: attrs(r.anchura, "10 mm", BASE_LABEL),
    });
    if (res.status === 200) summary.renamed++;
    else summary.errors.push({ type: "rename", varId: r.varId, status: res.status, msg: res.json.message });
  }

  for (const nv of op.new12mm) {
    const res = await wc(`products/${op.id}/variations`, "POST", {
      regular_price: String(nv.price),
      attributes: attrs(nv.anchura, nv.espesor, BASE_LABEL),
    });
    if (res.status === 201) summary.created++;
    else summary.errors.push({ type: "create12mm", variation: nv, status: res.status, msg: res.json.message });
  }

  const prod = await wc(`products/${op.id}`, "GET");
  const productAttrs = prod.json.attributes.map((a) => (a.name === "Tipo de cerradura" ? { ...a, options: ALL_OPTIONS } : a));
  productAttrs.push({ id: 11, name: "Espesor", options: ["10 mm", "12 mm"], variation: true, visible: true });
  const putProd = await wc(`products/${op.id}`, "PUT", { attributes: productAttrs });
  if (putProd.status !== 200) summary.errors.push({ type: "productAttrs", status: putProd.status, msg: putProd.json.message });

  for (const nc of op.newCerraduras) {
    const res = await wc(`products/${op.id}/variations`, "POST", {
      regular_price: String(nc.price),
      attributes: attrs(nc.anchura, nc.espesor, nc.cerradura),
    });
    if (res.status === 201) summary.created++;
    else summary.errors.push({ type: "createCerradura", variation: nc, status: res.status, msg: res.json.message });
  }

  return summary;
}

async function main() {
  const ops = JSON.parse(fs.readFileSync(path.join(__dirname, "o335-fenolica-ops-rest.json"), "utf-8"));
  const onlyId = process.argv[2] ? parseInt(process.argv[2]) : null;
  const toProcess = onlyId ? ops.filter((o) => o.id === onlyId) : ops;

  const results = [];
  for (const op of toProcess) {
    const s = await processOp(op);
    results.push(s);
    console.log(JSON.stringify(s));
  }

  const totalCreated = results.reduce((s, r) => s + r.created, 0);
  const totalRenamed = results.reduce((s, r) => s + r.renamed, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`\nRESUMEN: ${results.length} productos | ${totalRenamed} renombrados | ${totalCreated} creadas | ${totalErrors} errores`);
  if (totalErrors > 0) console.log("ERRORES:", JSON.stringify(results.filter((r) => r.errors.length > 0), null, 2));
}

main().catch((e) => console.error("ERR", e.message));
