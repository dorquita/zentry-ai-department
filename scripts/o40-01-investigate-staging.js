require("dotenv").config();
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

async function main() {
  // 1. Code Snippets on staging
  const sr = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: staging.auth } });
  const snippets = await sr.json();
  console.log("=== STAGING Code Snippets ===");
  snippets.forEach(s => console.log(s.id, "|", s.active, "|", s.scope, "|", s.name));

  // 2. snippet #15 full code
  const s15 = snippets.find(s => s.id === 15);
  console.log("\n=== snippet #15 full code ===");
  console.log(s15 ? s15.code : "NOT FOUND");

  // 3. WPCode posts on staging
  const wr = await fetch(staging.base + "/wp-json/wp/v2/wpcode?per_page=100&status=publish,draft", { headers: { Authorization: staging.auth } });
  console.log("\n=== STAGING wpcode status", wr.status, "===");
  const wt = await wr.text();
  console.log(wt.slice(0, 500));

  // 4. plugins active
  const pr = await fetch(staging.base + "/wp-json/wp/v2/plugins", { headers: { Authorization: staging.auth } });
  const plugins = await pr.json();
  console.log("\n=== STAGING active plugins (GA/analytics/consent related) ===");
  if (Array.isArray(plugins)) {
    plugins.filter(p => p.status === "active" && /analytics|site-kit|monsterinsights|complianz|consent|gtm|tag.manager/i.test(p.plugin + p.name)).forEach(p => console.log(p.plugin, "|", p.name));
    console.log("total active plugins:", plugins.filter(p=>p.status==="active").length);
  } else {
    console.log(JSON.stringify(plugins).slice(0,300));
  }

  // 5. check homepage for gtag / complianz
  const hr = await fetch(staging.base + "/?o40check=" + Date.now());
  const html = await hr.text();
  console.log("\n=== gtag present:", html.includes("gtag("), "===");
  console.log("=== G-tag id match:", (html.match(/G-[A-Z0-9]{6,12}/) || [])[0], "===");
  console.log("=== GTM- match:", (html.match(/GTM-[A-Z0-9]{4,10}/) || [])[0], "===");
  console.log("=== complianz present:", /cmplz|complianz/i.test(html), "===");
  const cmplzZ = html.match(/cmplz-cookiebanner[^"]*"[^}]*z-index:\s*(\d+)/i);
  console.log("=== complianz z-index hint:", cmplzZ ? cmplzZ[1] : "not found in inline html, check CSS file", "===");
}
main().catch(e => console.error("ERR", e.message, e.stack));
