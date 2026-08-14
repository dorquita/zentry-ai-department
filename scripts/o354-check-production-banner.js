require("dotenv").config();
const prodBase = process.env.WORDPRESS_PRODUCTION_BASE_URL;

fetch(prodBase + "/?qa354=" + Date.now())
  .then(r => r.text())
  .then(html => {
    const idx = html.indexOf('var complianz =');
    if (idx === -1) { console.log("NOT FOUND var complianz on production"); return; }
    const end = html.indexOf('</script>', idx);
    console.log(html.slice(idx, end));
  })
  .catch(e => console.error("ERR", e.message));
