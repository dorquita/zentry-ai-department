require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

// [productId, resbalon30_varId, resbalon40_varId, price30, price40]
// Cabinet variations are deliberately left untouched (still placeholder price) --
// they stay out of scope until the página-34 cerradura ambiguity is resolved.
const classA = [
  [597, 599, 601, 254, 277],
  [1286, 1288, 1290, 280, 303],
  [603, 605, 607, 280, 303],
  [609, 611, 613, 309, 334],
  [1291, 1293, 1295, 334, 363],
  [1296, 1298, 1300, 392, 426],
  [1301, 1303, 1305, 435, 471],
  [1306, 1308, 1310, 478, 518],
  [1311, 1313, 1315, 520, 563],
];

async function wc(path, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function main() {
  const results = [];
  for (const [id, r30, r40, price30, price40] of classA) {
    const log = { id };

    const up30 = await wc(`products/${id}/variations/${r30}`, "PUT", {
      regular_price: String(price30),
      sale_price: "",
    });
    const up40 = await wc(`products/${id}/variations/${r40}`, "PUT", {
      regular_price: String(price40),
      sale_price: "",
    });
    log.resbalon30 = { varId: r30, status: up30.status, price: up30.json.price };
    log.resbalon40 = { varId: r40, status: up40.status, price: up40.json.price };

    results.push(log);
    console.log(JSON.stringify(log));
  }
  console.log("\nDONE. " + results.length + " productos procesados.");
}

main().catch((e) => console.error("ERR", e.message));
