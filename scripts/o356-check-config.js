require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

fetch(base + "/?o356=" + Date.now())
  .then(r => r.text())
  .then(html => {
    const idx = html.indexOf('var complianz =');
    const end = html.indexOf('</script>', idx);
    console.log(html.slice(idx, end));
  })
  .catch(e => console.error("ERR", e.message));
