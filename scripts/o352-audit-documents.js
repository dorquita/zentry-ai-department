require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

fetch(base + "/wp-json/complianz/v1/documents", { headers: { Authorization: auth } })
  .then(async r => {
    console.log("STATUS", r.status);
    const text = await r.text();
    console.log(text);
  })
  .catch(e => console.error("ERR", e.message));
