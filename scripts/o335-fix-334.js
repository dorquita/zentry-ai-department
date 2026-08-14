require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const OLD_VAR_IDS = [1743,1742,1741,1740,1739,1738,1737,1736,1735,1734,1733,1732,1731,1730,1729,1728,1727,1726,1725,1724,1723,1722,1721,1720,1719,1718,1717,1716,1715,1714,1713,1712,1711,1710,1709,1708,1707,1706,1705,1704,1703,1702,1701,1700,1699,1698,1697,1696,1695,1694];

async function wc(p, method, body) {
  const r = await fetch(`${base}/wp-json/wc/v3/${p}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function main() {
  console.log("1. Privatizando 50 variaciones antiguas...");
  let privatized = 0;
  for (const varId of OLD_VAR_IDS) {
    const res = await wc(`products/334/variations/${varId}`, "PUT", { status: "private" });
    if (res.status === 200) privatized++;
    else console.log("  ERROR", varId, res.status, res.json.message);
  }
  console.log(`  ${privatized}/${OLD_VAR_IDS.length} privatizadas`);

  console.log("\n2. Actualizando opciones visibles del atributo Tipo de cerradura...");
  const prod = await wc("products/334", "GET");
  const attrs = prod.json.attributes.map((a) => {
    if (a.name === "Tipo de cerradura") return { ...a, options: ["Cerradura de bombillo"] };
    return a;
  });
  const putProd = await wc("products/334", "PUT", { attributes: attrs });
  console.log("  status:", putProd.status, JSON.stringify(putProd.json.attributes?.find((a) => a.name === "Tipo de cerradura")?.options));

  console.log("\n3. Creando 2 variaciones reales (Bombillo)...");
  const cases = [
    { anchura_id: 62, price: "194" }, // 30cm
    { anchura_id: 63, price: "239" }, // 40cm
  ];
  for (const c of cases) {
    const res = await wc("products/334/variations", "POST", {
      regular_price: c.price,
      attributes: [
        { id: 3, option: c.anchura_id === 62 ? "30cm" : "40cm" },
        { id: 4, option: "Cerradura de bombillo" },
      ],
    });
    console.log("  ", res.status, JSON.stringify(res.json.attributes?.map((a) => a.option)), res.json.price);
  }

  console.log("\n4. Verificando via Store API...");
  const store = await fetch(`${base}/wp-json/wc/store/v1/products/334?nocache=${Date.now()}`);
  const storeJson = await store.json();
  console.log("  purchasable:", storeJson.is_purchasable, "| range:", JSON.stringify(storeJson.prices?.price_range), "| variations:", storeJson.variations?.length);
  for (const v of storeJson.variations || []) console.log("    ", v.id, JSON.stringify(v.attributes));
}

main().catch((e) => console.error("ERR", e.message));
