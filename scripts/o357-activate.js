require("dotenv").config();
const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

fetch(base + "/wp-json/code-snippets/v1/snippets/16", {
  method: "PUT",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify({ active: true }),
})
  .then(async (r) => {
    const j = await r.json();
    console.log("STATUS", r.status);
    console.log(JSON.stringify({ id: j.id, active: j.active, code_error: j.code_error }));
  })
  .catch((e) => console.error("ERR", e.message));
