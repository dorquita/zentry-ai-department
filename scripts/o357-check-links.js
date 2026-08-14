require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

fetch(base + "/?o357check=" + Date.now())
  .then(r => r.text())
  .then(html => {
    const idx = html.indexOf('"page_links"');
    console.log(html.slice(idx, idx + 320));
  })
  .catch(e => console.error("ERR", e.message));
