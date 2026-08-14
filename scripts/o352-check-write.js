require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function check(path, method) {
  const r = await fetch(base + path, { method, headers: { Authorization: auth } });
  console.log(method, path, "->", r.status);
}

async function main() {
  await check("/wp-json/complianz/v1/documents", "OPTIONS");
  await check("/wp-json/complianz/v1/documents/cookie-statement", "OPTIONS");
  await check("/wp-json/complianz/v1/documents/cookie-statement", "GET");
  await check("/wp-json/complianz/v1/banner", "OPTIONS");
}
main().catch(e => console.error("ERR", e.message));
