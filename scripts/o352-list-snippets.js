require("dotenv").config();
const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

fetch(base + "/wp-json/code-snippets/v1/snippets", { headers: { Authorization: auth } })
  .then(r => r.json())
  .then(list => {
    for (const s of list) console.log(s.id, "|", s.active, "|", s.name);
  })
  .catch(e => console.error("ERR", e.message));
