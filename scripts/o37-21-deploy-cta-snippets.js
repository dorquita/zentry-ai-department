require("dotenv").config();
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

const snippet15 = require("/opt/zentry-ai-department/reports/o37-staging-snippet-15.json");
const snippet16 = require("/opt/zentry-ai-department/reports/o37-staging-snippet-16.json");

async function createSnippet(name, desc, code) {
  const r = await fetch(prod.base + "/wp-json/code-snippets/v1/snippets", {
    method: "POST",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name, desc, code, scope: "front-end", active: false }),
  });
  const j = await r.json();
  return j;
}

async function activateSnippet(id) {
  const r = await fetch(prod.base + "/wp-json/code-snippets/v1/snippets/" + id, {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  return await r.json();
}

async function main() {
  // Snippet 1: O33 CTA presupuesto - no hardcoded URLs, safe as-is
  const s1 = await createSnippet(
    "O33/O33.2 - CTA presupuesto proyecto a medida (replicado de staging en O37) - PRODUCCION",
    "Replica en produccion el CTA de presupuesto personalizado ya validado en staging (snippet #15). Usa home_url() dinamico, sin URLs fijas. Fase O37.",
    snippet15.code
  );
  console.log("snippet 1 created:", JSON.stringify({ id: s1.id, code_error: s1.code_error }));

  // Snippet 2: O33.2 cross-sell cerraduras - FIX hardcoded staging URL before deploying
  const fixedCode16 = snippet16.code.replace(
    "https://staging.zentrylockers.com/cerraduras-para-taquillas/",
    "https://zentrylockers.com/cerraduras-para-taquillas/"
  );
  if (fixedCode16 === snippet16.code) {
    console.log("WARNING: URL replacement did not match anything, aborting to avoid deploying broken link");
    return;
  }
  const s2 = await createSnippet(
    "O33.2 - Cross-sell cerraduras en fichas de taquillas (replicado de staging en O37, URL corregida a produccion) - PRODUCCION",
    "Replica en produccion el cross-sell de cerraduras ya validado en staging (snippet #16). CORREGIDO: la URL hardcodeada staging.zentrylockers.com/cerraduras-para-taquillas/ se cambio a zentrylockers.com/cerraduras-para-taquillas/ antes de desplegar. Fase O37.",
    fixedCode16
  );
  console.log("snippet 2 created:", JSON.stringify({ id: s2.id, code_error: s2.code_error }));

  if (s1.code_error === null) {
    const a1 = await activateSnippet(s1.id);
    console.log("snippet 1 activated:", JSON.stringify({ id: a1.id, active: a1.active, code_error: a1.code_error }));
  } else {
    console.log("snippet 1 NOT activated due to code_error");
  }

  if (s2.code_error === null) {
    const a2 = await activateSnippet(s2.id);
    console.log("snippet 2 activated:", JSON.stringify({ id: a2.id, active: a2.active, code_error: a2.code_error }));
  } else {
    console.log("snippet 2 NOT activated due to code_error");
  }
}
main().catch((e) => console.error("ERR", e.message, e.stack));
