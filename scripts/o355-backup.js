require("dotenv").config();
const fs = require("fs");
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

async function main() {
  const backup = { timestamp: new Date().toISOString(), base };

  const rs = await fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } });
  backup.snippets_before = await rs.json();

  const rh = await fetch(base + "/?o355backup=" + Date.now());
  const html = await rh.text();
  const idx = html.indexOf('var complianz =');
  const end = html.indexOf('</script>', idx);
  backup.complianz_js_config_before = idx !== -1 ? html.slice(idx, end) : "NOT FOUND";

  fs.writeFileSync("/opt/zentry-ai-department/reports/o355-production-backup-before.json", JSON.stringify(backup, null, 2));
  console.log("Backup written. Snippets count:", backup.snippets_before.length);
  console.log("Complianz config captured:", backup.complianz_js_config_before !== "NOT FOUND");
}
main().catch(e => console.error("ERR", e.message));
