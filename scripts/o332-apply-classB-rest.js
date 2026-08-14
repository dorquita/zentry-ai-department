require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

// [productId, var30ResbalonId, var40ResbalonId, price30_10mm, price30_12mm, price40_10mm, price40_12mm]
const classB = [
  [1325, 1327, 1329, 344, 359, 375, 396],
  [1343, 1345, 1347, 366, 384, 399, 421],
  [1331, 1333, 1335, 371, 387, 405, 427],
  [1337, 1339, 1341, 396, 413, 434, 456],
  [1349, 1351, 1353, 490, 512, 529, 564],
  [1355, 1357, 1359, 539, 567, 584, 624],
  [1361, 1363, 1365, 595, 629, 645, 691],
  [1367, 1369, 1371, 641, 675, 698, 743],
  [1373, 1375, 1377, 615, 650, 669, 715],
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
  for (const [id, var30, var40, p30_10, p30_12, p40_10, p40_12] of classB) {
    const log = { id };

    const prod = await wc(`products/${id}`, "GET");
    const attrs = [...prod.json.attributes, { id: 11, name: "Espesor", options: ["10 mm", "12 mm"], variation: true, visible: true }];
    const putProd = await wc(`products/${id}`, "PUT", { attributes: attrs });
    log.productUpdate = putProd.status;

    const up30 = await wc(`products/${id}/variations/${var30}`, "PUT", {
      regular_price: String(p30_10),
      sale_price: "",
      attributes: [
        { id: 0, name: "Anchura", option: "30 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
        { id: 11, name: "Espesor", option: "10 mm" },
      ],
    });
    const up40 = await wc(`products/${id}/variations/${var40}`, "PUT", {
      regular_price: String(p40_10),
      sale_price: "",
      attributes: [
        { id: 0, name: "Anchura", option: "40 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
        { id: 11, name: "Espesor", option: "10 mm" },
      ],
    });
    log.var30_10mm = { id: var30, status: up30.status, price: up30.json.price };
    log.var40_10mm = { id: var40, status: up40.status, price: up40.json.price };

    const new30 = await wc(`products/${id}/variations`, "POST", {
      regular_price: String(p30_12),
      attributes: [
        { id: 0, name: "Anchura", option: "30 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
        { id: 11, name: "Espesor", option: "12 mm" },
      ],
    });
    const new40 = await wc(`products/${id}/variations`, "POST", {
      regular_price: String(p40_12),
      attributes: [
        { id: 0, name: "Anchura", option: "40 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Resbalón" },
        { id: 11, name: "Espesor", option: "12 mm" },
      ],
    });
    log.new30_12mm = { id: new30.json.id, status: new30.status, price: new30.json.price };
    log.new40_12mm = { id: new40.json.id, status: new40.status, price: new40.json.price };

    console.log(JSON.stringify(log));
  }
  console.log("\nDONE. " + classB.length + " productos procesados.");
}

main().catch((e) => console.error("ERR", e.message));
