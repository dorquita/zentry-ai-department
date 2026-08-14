require("dotenv").config();
const fs = require("fs");
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const data = JSON.parse(fs.readFileSync("/opt/zentry-ai-department/reports/o37-stale-variations.json", "utf8"));
  console.log("products to process:", data.length, "| total variations to delete:", data.reduce((s, r) => s + r.stale.length, 0));

  const PRODUCTS_PER_BATCH = 5;
  let totalDeleted = 0;
  let stoppedEarly = false;

  for (let i = 0; i < data.length; i += PRODUCTS_PER_BATCH) {
    const batchProducts = data.slice(i, i + PRODUCTS_PER_BATCH);
    console.log("\n--- Batch", i / PRODUCTS_PER_BATCH + 1, ": products", batchProducts.map((p) => p.productId).join(",") + " ---");

    let batchOk = true;
    for (const entry of batchProducts) {
      const ids = entry.stale.map((s) => s.id);
      const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + entry.productId + "/variations/batch", {
        method: "POST",
        headers: { Authorization: prod.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ delete: ids }),
      });
      const j = await r.json();
      if (!j.delete) {
        console.log("  ERROR product", entry.productId, "- no delete array in response:", JSON.stringify(j).slice(0, 300));
        batchOk = false;
        break;
      }
      const errs = j.delete.filter((d) => d.error);
      if (errs.length) {
        console.log("  ERROR product", entry.productId, "- delete errors:", JSON.stringify(errs));
        batchOk = false;
        break;
      }
      totalDeleted += j.delete.length;
      console.log("  product", entry.productId, "- deleted", j.delete.length, "ids:", ids.join(","));
    }

    if (!batchOk) {
      console.log("\nSTOPPING due to error in this batch. Total deleted before stop:", totalDeleted);
      stoppedEarly = true;
      break;
    }

    // verify: fetch variations for each product in this batch, confirm none of the deleted IDs remain
    let verifyOk = true;
    for (const entry of batchProducts) {
      const idsToCheck = new Set(entry.stale.map((s) => s.id));
      const vr = await fetch(prod.base + "/wp-json/wc/v3/products/" + entry.productId + "/variations?per_page=100", { headers: { Authorization: prod.auth } });
      const vars = await vr.json();
      const stillThere = vars.filter((v) => idsToCheck.has(v.id));
      if (stillThere.length > 0) {
        console.log("  VERIFY FAIL product", entry.productId, "- still present:", stillThere.map((v) => v.id).join(","));
        verifyOk = false;
      } else {
        console.log("  verify OK product", entry.productId, "- stale IDs confirmed gone");
      }
    }

    if (!verifyOk) {
      console.log("\nSTOPPING due to verification failure after this batch.");
      stoppedEarly = true;
      break;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log("total deleted:", totalDeleted, "/ 106");
  console.log("stopped early due to error:", stoppedEarly);
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
