require("dotenv").config();
const base = process.env.WORDPRESS_STAGING_BASE_URL;

fetch(base + "/?nocache=" + Date.now())
  .then(r => r.text())
  .then(html => {
    // Complianz typically outputs a script tag with var complianz = {...} or similar
    const patterns = ['var complianz', 'complianz =', 'cmplz_settings', 'documents:', 'cookie-statement', 'privacy-statement'];
    for (const p of patterns) {
      let idx = html.indexOf(p);
      if (idx !== -1) {
        console.log("=== match:", p, "at", idx, "===");
        console.log(html.slice(Math.max(0, idx - 100), idx + 600));
        console.log("\n");
      } else {
        console.log("=== no match:", p, "===");
      }
    }
  })
  .catch(e => console.error("ERR", e.message));
