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
  "",
  "add_filter('gettext_with_context', function ($translated, $original, $context, $domain) {",
  "    if ($domain === 'complianz-gdpr' && $original === 'Impressum') {",
  "        return 'Aviso legal';",
  "    }",
  "    return $translated;",
  "}, 10, 4);",
].join("\n");

const body = {
  name: "O35.7/O35.8 - Traducir Impressum a Aviso legal (Complianz) - PRODUCCION",
  desc:
    "Sobreescribe la cadena exacta 'Impressum' del dominio complianz-gdpr por 'Aviso legal', cubriendo tanto traduccion simple (gettext, O35.7) como traduccion con contexto (gettext_with_context, O35.8). No toca la URL del documento, la logica de consentimiento, ni ninguna otra cadena. Editado e inactivado antes de verificar.",
  code,
  scope: "front-end",
  active: false,
};

fetch(base + "/wp-json/code-snippets/v1/snippets/16", {
  method: "PUT",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
  .then(async (r) => {
    const j = await r.json();
    console.log("STATUS", r.status);
    console.log(JSON.stringify({ id: j.id, active: j.active, code_error: j.code_error }));
  })
  .catch((e) => console.error("ERR", e.message));
