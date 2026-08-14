require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

// [productId, var30ResbalonId, var40ResbalonId, price30, price40]
const classC = [
  [440, 442, 444, 289, 323],
  [408, 410, 412, 274, 305],
  [425, 427, 429, 291, 337],
  [339, 341, 343, 371, 433],
  [393, 395, 397, 434, 512],
  [445, 447, 449, 517, 611],
  [420, 422, 424, 481, 569],
  [430, 432, 434, 528, 626],
  [364, 366, 368, 499, 617],
  [398, 400, 402, 634, 742],
  [450, 452, 454, 756, 889],
  [413, 415, 417, 704, 825],
  [435, 437, 439, 778, 909],
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
  for (const [id, var30, var40, price30, price40] of classC) {
    const log = { id };

    const prod = await wc(`products/${id}`, "GET");
    const attrs = prod.json.attributes.map((a) => {
      if (a.name === "Tipo de cerradura") return { ...a, options: a.options.map((o) => (o === "Resbalón" ? "Bombillo" : o)) };
      return a;
    });
    const putProd = await wc(`products/${id}`, "PUT", { attributes: attrs });
    log.productUpdate = putProd.status;

    const up30 = await wc(`products/${id}/variations/${var30}`, "PUT", {
      regular_price: String(price30),
      sale_price: "",
      attributes: [
        { id: 0, name: "Anchura", option: "30 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Bombillo" },
      ],
    });
    const up40 = await wc(`products/${id}/variations/${var40}`, "PUT", {
      regular_price: String(price40),
      sale_price: "",
      attributes: [
        { id: 0, name: "Anchura", option: "40 cm" },
        { id: 0, name: "Tipo de cerradura", option: "Bombillo" },
      ],
    });
    log.var30 = { id: var30, status: up30.status, price: up30.json.price };
    log.var40 = { id: var40, status: up40.status, price: up40.json.price };

    console.log(JSON.stringify(log));
  }
  console.log("\nDONE. " + classC.length + " productos procesados.");
}

main().catch((e) => console.error("ERR", e.message));
