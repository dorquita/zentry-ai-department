require("dotenv").config();

const staging = {
  auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"),
  base: process.env.WORDPRESS_STAGING_BASE_URL,
};
const prod = {
  auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"),
  base: process.env.WORDPRESS_PRODUCTION_BASE_URL,
};

async function countByStatus(env, status) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products?per_page=1&status=" + status, {
    headers: { Authorization: env.auth },
  });
  const total = r.headers.get("x-wp-total");
  return total;
}

async function countVariableProducts(env) {
  const r = await fetch(env.base + "/wp-json/wc/v3/products?per_page=1&type=variable&status=any", {
    headers: { Authorization: env.auth },
  });
  return r.headers.get("x-wp-total");
}

async function main() {
  for (const [name, env] of [["STAGING", staging], ["PRODUCTION", prod]]) {
    console.log("===", name, env.base, "===");
    for (const status of ["publish", "private", "draft", "any"]) {
      const c = await countByStatus(env, status);
      console.log("  status=" + status + ":", c);
    }
    const varCount = await countVariableProducts(env);
    console.log("  variable products (any status):", varCount);
    console.log("");
  }
}
main().catch((e) => console.error("ERR", e.message));
