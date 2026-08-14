require("dotenv").config();
const base = process.env.WORDPRESS_STAGING_BASE_URL;

fetch(base + "/?qa353=" + Date.now())
  .then(r => r.text())
  .then(html => {
    const idx = html.indexOf('var complianz =');
    if (idx === -1) { console.log("NOT FOUND"); return; }
    const end = html.indexOf('</script>', idx);
    console.log(html.slice(idx, end));
  })
  .catch(e => console.error("ERR", e.message));
