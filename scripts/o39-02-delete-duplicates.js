require("dotenv").config();
const fs = require("fs");
const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

async function main() {
  const candidates = JSON.parse(fs.readFileSync("/opt/zentry-ai-department/reports/o39-final-delete-candidates.json", "utf8"));

  // group by productId
  const byProduct = {};
  for (const c of candidates) {
    (byProduct[c.productId] = byProduct[c.productId] || []).push(c.id);
  }
  const productIds = Object.keys(byProduct);
  console.log("products to process:", productIds.length, "| total variations to delete:", candidates.length);

  const PRODUCTS_PER_BATCH = 5;
  let totalDeleted = 0;
  let stoppedEarly = false;

  for (let i = 0; i < productIds.length; i += PRODUCTS_PER_BATCH) {
    const batchProductIds = productIds.slice(i, i + PRODUCTS_PER_BATCH);
    console.log("\n--- Batch", Math.floor(i / PRODUCTS_PER_BATCH) + 1, ": products", batchProductIds.join(",") + " ---");

    let batchOk = true;
    for (const pid of batchProductIds) {
      const ids = byProduct[pid];
      const r = await fetch(prod.base + "/wp-json/wc/v3/products/" + pid + "/variations/batch", {
        method: "POST",
        headers: { Authorization: prod.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ delete: ids }),
      });
      const j = await r.json();
      if (!j.delete) {
        console.log("  ERROR product", pid, "- no delete array in response:", JSON.stringify(j).slice(0, 300));
        batchOk = false;
        break;
      }
      const errs = j.delete.filter((d) => d.error);
      if (errs.length) {
        console.log("  ERROR product", pid, "- delete errors:", JSON.stringify(errs));
        batchOk = false;
        break;
      }
      totalDeleted += j.delete.length;
      console.log("  product", pid, "- deleted", j.delete.length, "ids:", ids.join(","));
    }

    if (!batchOk) {
      console.log("\nSTOPPING due to error in this batch. Total deleted before stop:", totalDeleted);
      stoppedEarly = true;
      break;
    }

    // verify: fetch variations for each product in this batch, confirm none of the deleted IDs remain
    let verifyOk = true;
    for (const pid of batchProductIds) {
      const idsToCheck = new Set(byProduct[pid]);
      const vr = await fetch(prod.base + "/wp-json/wc/v3/products/" + pid + "/variations?per_page=100", { headers: { Authorization: prod.auth } });
      const vars = await vr.json();
      const stillThere = vars.filter((v) => idsToCheck.has(v.id));
      if (stillThere.length > 0) {
        console.log("  VERIFY FAIL product", pid, "- still present:", stillThere.map((v) => v.id).join(","));
        verifyOk = false;
      } else {
        console.log("  verify OK product", pid, "- duplicate IDs confirmed gone, remaining variations:", vars.length);
      }
    }

    if (!verifyOk) {
      console.log("\nSTOPPING due to verification failure after this batch.");
      stoppedEarly = true;
      break;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log("total deleted:", totalDeleted, "/", candidates.length);
  console.log("stopped early due to error:", stoppedEarly);
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
