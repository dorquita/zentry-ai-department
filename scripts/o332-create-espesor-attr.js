require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  // Check if "Espesor" attribute already exists first (idempotency)
  const listRes = await fetch(`${base}/wp-json/wc/v3/products/attributes?per_page=100`, {
    headers: { Authorization: auth },
  });
  const existing = await listRes.json();
  let attr = existing.find((a) => a.name === "Espesor");

  if (attr) {
    console.log("Atributo Espesor ya existe, ID", attr.id);
  } else {
    const createRes = await fetch(`${base}/wp-json/wc/v3/products/attributes`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Espesor", type: "select", order_by: "menu_order", has_archives: false }),
    });
    attr = await createRes.json();
    console.log("STATUS crear atributo:", createRes.status);
    console.log("Atributo creado:", JSON.stringify(attr));
  }

  if (attr.code) {
    console.error("ERROR creando atributo:", JSON.stringify(attr));
    return;
  }

  // Check/create terms 10 mm and 12 mm
  const termsRes = await fetch(`${base}/wp-json/wc/v3/products/attributes/${attr.id}/terms?per_page=100`, {
    headers: { Authorization: auth },
  });
  const existingTerms = await termsRes.json();
  console.log("Terminos existentes:", existingTerms.map((t) => t.name).join(", ") || "(ninguno)");

  for (const termName of ["10 mm", "12 mm"]) {
    if (existingTerms.find((t) => t.name === termName)) {
      console.log(`Termino "${termName}" ya existe`);
      continue;
    }
    const r = await fetch(`${base}/wp-json/wc/v3/products/attributes/${attr.id}/terms`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: termName }),
    });
    const t = await r.json();
    console.log(`Termino creado "${termName}":`, r.status, JSON.stringify(t.id ? { id: t.id, slug: t.slug } : t));
  }

  console.log("\nATTR_ID=" + attr.id);
}

main().catch((e) => console.error("ERR", e.message));
