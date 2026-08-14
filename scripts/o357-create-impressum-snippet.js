require("dotenv").config();

const user = process.env.WORDPRESS_PRODUCTION_USERNAME;
const pass = process.env.WORDPRESS_PRODUCTION_APP_PASSWORD;
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const code = [
  "add_filter('gettext', function ($translated, $original, $domain) {",
  "    if ($domain === 'complianz-gdpr' && $original === 'Impressum') {",
  "        return 'Aviso legal';",
  "    }",
  "    return $translated;",
  "}, 10, 3);",
].join("\n");

const body = {
  name: "O35.7 - Traducir Impressum a Aviso legal (Complianz) - PRODUCCION",
  desc:
    "Sobreescribe unicamente la cadena exacta 'Impressum' del dominio de texto complianz-gdpr por 'Aviso legal'. No toca la URL del documento (sigue siendo /aviso-legal/), ni la logica de consentimiento, ni ninguna otra cadena del plugin o del sitio. Fase O35.7 -- creado inactivo, se activa tras validar.",
  code,
  scope: "front-end",
  active: false,
};

fetch(base + "/wp-json/code-snippets/v1/snippets", {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
  .then(async (r) => {
    const j = await r.json();
    console.log("STATUS", r.status);
    console.log(JSON.stringify({ id: j.id, code_error: j.code_error }));
  })
  .catch((e) => console.error("ERR", e.message));
