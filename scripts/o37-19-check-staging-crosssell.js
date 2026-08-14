require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

async function main() {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: staging.auth } });
  const list = await r.json();
  for (const s of list) {
    console.log(s.id, "|", s.active, "|", s.name);
  }
}
main().catch(e => console.error("ERR", e.message));
