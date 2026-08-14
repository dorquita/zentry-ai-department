require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

fetch(base + "/wp-json/", { headers: { Authorization: auth } })
  .then(r => r.json())
  .then(j => {
    const routes = Object.keys(j.routes || {}).filter(r => r.includes('complianz') || r.includes('cmplz'));
    console.log(JSON.stringify(routes, null, 2));
  })
  .catch(e => console.error("ERR", e.message));
