require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const css = [
  "#cmplz-cookiebanner--optin.cmplz-cookiebanner{",
  "  max-width:440px !important;",
  "  width:calc(100% - 2rem) !important;",
  "  border-radius:14px !important;",
  "  box-shadow:0 12px 40px rgba(20,23,29,.18) !important;",
  "  padding:20px 22px !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-title{",
  "  font-size:1.05rem !important;",
  "  font-weight:700 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-message{",
  "  font-size:.87rem !important;",
  "  line-height:1.5 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-buttons{",
  "  display:flex !important;",
  "  flex-direction:column !important;",
  "  flex-wrap:nowrap !important;",
  "  gap:8px !important;",
  "  margin-top:14px !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-buttons .cmplz-btn{",
  "  width:100% !important;",
  "  box-sizing:border-box !important;",
  "  padding:11px 16px !important;",
  "  border-radius:8px !important;",
  "  font-size:.92rem !important;",
  "  margin:0 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-btn.cmplz-accept{",
  "  background:#2657d9 !important;",
  "  border-color:#2657d9 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-btn.cmplz-accept:hover{",
  "  background:#1c3fa0 !important;",
  "  border-color:#1c3fa0 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-documents.cmplz-links ul,",
  "#cmplz-cookiebanner--optin .cmplz-documents.cmplz-links li{",
  "  list-style:none !important;",
  "  list-style-type:none !important;",
  "  margin:0 !important;",
  "  padding:0 !important;",
  "}",
  "#cmplz-cookiebanner--optin .cmplz-documents.cmplz-links{",
  "  margin-top:6px !important;",
  "}",
  "@media (max-width:480px){",
  "  #cmplz-cookiebanner--optin.cmplz-cookiebanner{",
  "    max-width:calc(100% - 1.25rem) !important;",
  "    padding:16px 18px !important;",
  "  }",
  "  #cmplz-cookiebanner--optin .cmplz-message{",
  "    font-size:.83rem !important;",
  "  }",
  "}",
].join("\n");

const code = [
  "add_action('wp_head', function () {",
  "    echo '<style id=\"o351-cookie-banner-fix\">' . " + JSON.stringify(css) + " . '</style>';",
  "});",
].join("\n");

const body = {
  name: "O35.1 - Fix visual banner de cookies (Complianz)",
  desc:
    "Corrige el tamano excesivo del modal de consentimiento de Complianz en desktop, alinea y compacta los botones (Aceptar/Denegar/Ver preferencias), y elimina los bullets sueltos causados por el listado de enlaces legales (cookie-statement/privacy-statement/impressum) que Complianz renderiza sin list-style:none cuando esos enlaces estan vacios o mal mapeados. Solo CSS, no toca la logica de consentimiento ni los botones de accion. Fase O35.1 -- creado inactivo, se activa tras validar.",
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
