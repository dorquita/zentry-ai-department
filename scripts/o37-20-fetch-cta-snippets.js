require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

async function main() {
  for (const id of [15, 16]) {
    const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets/" + id, { headers: { Authorization: staging.auth } });
    const s = await r.json();
    require("fs").writeFileSync("/opt/zentry-ai-department/reports/o37-staging-snippet-" + id + ".json", JSON.stringify(s, null, 2));
    console.log(id, s.name, "- scope:", s.scope, "- code length:", (s.code||"").length);
  }
}
main().catch(e => console.error("ERR", e.message));
