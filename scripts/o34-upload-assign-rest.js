require("dotenv").config();
const fs = require("fs");
const path = require("path");

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const EXTRACTED_DIR = "/opt/zentry-ai-department/clients/zentry/work/o34-extracted";

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  return "image/jpeg";
}

async function uploadMedia(localPath, title, alt) {
  const fullPath = path.join(EXTRACTED_DIR, localPath);
  const buf = fs.readFileSync(fullPath);
  const filename = path.basename(localPath).normalize("NFC");
  const mime = mimeFor(localPath);

  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), filename);
  form.append("title", title);
  form.append("alt_text", alt);
  form.append("caption", "");
  form.append("description", "");

  const r = await fetch(`${base}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  });
  const j = await r.json();
  if (r.status !== 201) {
    return { ok: false, status: r.status, error: j.message || JSON.stringify(j), localPath };
  }
  return { ok: true, id: j.id, source_url: j.source_url, localPath };
}

async function wc(p, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${p}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function processProduct(op) {
  const summary = { productId: op.productId, productName: op.productName, uploaded: [], errors: [] };

  const featuredUp = await uploadMedia(op.featured.localPath, op.featured.title, op.featured.alt);
  if (!featuredUp.ok) {
    summary.errors.push({ stage: "upload-featured", ...featuredUp });
    return summary;
  }
  summary.uploaded.push({ role: "featured", ...featuredUp });

  const galleryIds = [];
  for (const g of op.gallery) {
    const gUp = await uploadMedia(g.localPath, g.title, g.alt);
    if (!gUp.ok) {
      summary.errors.push({ stage: "upload-gallery", ...gUp });
      continue;
    }
    summary.uploaded.push({ role: "gallery", ...gUp });
    galleryIds.push(gUp.id);
  }

  const images = [{ id: featuredUp.id }, ...galleryIds.map((id) => ({ id }))];
  const put = await wc(`products/${op.productId}`, "PUT", { images });
  summary.productUpdateStatus = put.status;
  if (put.status !== 200) summary.errors.push({ stage: "product-update", status: put.status, msg: put.json.message });

  return summary;
}

async function main() {
  const ops = JSON.parse(fs.readFileSync(path.join(__dirname, "o34-final-ops-rest.json"), "utf-8"));
  const onlyId = process.argv[2] ? parseInt(process.argv[2]) : null;
  const toProcess = onlyId ? ops.filter((o) => o.productId === onlyId) : ops;

  const results = [];
  for (const op of toProcess) {
    const s = await processProduct(op);
    results.push(s);
    console.log(JSON.stringify({ productId: s.productId, uploaded: s.uploaded.length, errors: s.errors.length, productUpdateStatus: s.productUpdateStatus }));
    if (s.errors.length) console.log("  ERRORS:", JSON.stringify(s.errors));
  }

  fs.writeFileSync(path.join(__dirname, `o34-upload-results-${onlyId || "all"}.json`), JSON.stringify(results, null, 2));
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log(`\nRESUMEN: ${results.length} productos | ${totalErrors} errores`);
}

main().catch((e) => console.error("ERR", e.message, e.stack));
