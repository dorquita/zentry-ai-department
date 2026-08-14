require("dotenv").config();
const fs = require("fs");
const path = require("path");

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const todo = JSON.parse(fs.readFileSync(path.join(__dirname, "o333-cabinet-todo.json"), "utf-8"));

async function wc(pathSuffix, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${pathSuffix}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function main() {
  const results = [];
  for (const { id, cabinetVarIds } of todo) {
    const log = { id, cabinetVarIds };

    // 1. Privatize each Cabinet variation (non-destructive hide)
    const varResults = [];
    for (const varId of cabinetVarIds) {
      const r = await wc(`products/${id}/variations/${varId}`, "PUT", { status: "private" });
      varResults.push({ varId, status: r.status, resultStatus: r.json.status });
    }
    log.variations = varResults;

    // 2. Remove Cabinet from product's visible attribute options
    const prod = await wc(`products/${id}`, "GET");
    const attrs = prod.json.attributes.map((a) => {
      if (a.name === "Tipo de cerradura") return { ...a, options: a.options.filter((o) => o !== "Cabinet") };
      return a;
    });
    const putProd = await wc(`products/${id}`, "PUT", { attributes: attrs });
    log.productUpdate = { status: putProd.status, options: putProd.json.attributes?.find((a) => a.name === "Tipo de cerradura")?.options };

    results.push(log);
    console.log(JSON.stringify(log));
  }
  console.log(`\nDONE. ${results.length} productos procesados, ${results.reduce((s, r) => s + r.cabinetVarIds.length, 0)} variaciones desactivadas.`);
}

main().catch((e) => console.error("ERR", e.message));
