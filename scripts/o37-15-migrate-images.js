require("dotenv").config();
const fs = require("fs");

const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function uploadImageToProduction(url) {
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error("download failed " + imgRes.status + " for " + url);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const filename = decodeURIComponent(url.split("/").pop().split("?")[0]);
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";

  const upRes = await fetch(prod.base + "/wp-json/wp/v2/media", {
    method: "POST",
    headers: {
      Authorization: prod.auth,
      "Content-Type": contentType,
      "Content-Disposition": 'attachment; filename="' + filename + '"',
    },
    body: buf,
  });
  const j = await upRes.json();
  if (!upRes.ok) throw new Error("upload failed " + upRes.status + " " + JSON.stringify(j).slice(0, 200));
  return { id: j.id, source_url: j.source_url };
}

async function main() {
  const compare = JSON.parse(fs.readFileSync("/opt/zentry-ai-department/reports/o36-catalog-compare.json", "utf8"));
  const imageDiffIds = compare.diffs.filter((d) => d.diffs.some((f) => f.includes("image_count"))).map((d) => d.id);
  console.log("products needing image migration:", imageDiffIds.length);

  const results = [];
  for (const id of imageDiffIds) {
    const r = await fetch(staging.base + "/wp-json/wc/v3/products/" + id, { headers: { Authorization: staging.auth } });
    const sp = await r.json();
    const stagingImages = sp.images || [];
    if (stagingImages.length === 0) {
      console.log(id, "- no staging images, skip");
      continue;
    }

    const uploaded = [];
    const errors = [];
    for (const img of stagingImages) {
      try {
        const up = await uploadImageToProduction(img.src);
        uploaded.push(up);
      } catch (e) {
        errors.push(img.src + " -> " + e.message);
      }
    }

    if (uploaded.length > 0) {
      const patchRes = await fetch(prod.base + "/wp-json/wc/v3/products/" + id, {
        method: "PUT",
        headers: { Authorization: prod.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ images: uploaded.map((u) => ({ id: u.id })) }),
      });
      const patched = await patchRes.json();
      console.log(id, sp.name, "-> uploaded:", uploaded.length, "/", stagingImages.length, errors.length ? "ERRORS: " + errors.join(" | ") : "", "product image_count now:", (patched.images || []).length);
      results.push({ id, name: sp.name, stagingImageCount: stagingImages.length, uploadedCount: uploaded.length, errors, newProductImageCount: (patched.images || []).length });
    } else {
      console.log(id, sp.name, "-> FAILED, no images uploaded. errors:", errors.join(" | "));
      results.push({ id, name: sp.name, stagingImageCount: stagingImages.length, uploadedCount: 0, errors });
    }
  }

  fs.writeFileSync("/opt/zentry-ai-department/reports/o37-images-migration-summary.json", JSON.stringify(results, null, 2));
  const totalUploaded = results.reduce((s, r) => s + r.uploadedCount, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
  console.log("\n=== TOTAL ===");
  console.log("products processed:", results.length, "| images uploaded:", totalUploaded, "| errors:", totalErrors);
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
