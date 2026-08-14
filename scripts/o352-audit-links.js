require("dotenv").config();
const base = process.env.WORDPRESS_STAGING_BASE_URL;

fetch(base + "/?nocache=" + Date.now())
  .then(r => r.text())
  .then(html => {
    // find all occurrences of cmplz-documents, take the last (actual banner markup, not our CSS)
    let idx = -1, last = -1;
    while ((idx = html.indexOf('cmplz-documents', idx + 1)) !== -1) last = idx;
    if (last === -1) { console.log("NOT FOUND"); return; }
    console.log(html.slice(last - 50, last + 2000));
  })
  .catch(e => console.error("ERR", e.message));
