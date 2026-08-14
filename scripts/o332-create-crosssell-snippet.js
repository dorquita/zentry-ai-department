require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const code = [
  "add_action('woocommerce_single_product_summary', function () {",
  "    global $product;",
  "    if (!$product instanceof WC_Product) return;",
  "    if (!has_term(['taquillas', 'taquillas-fenolicas', 'taquillas-de-melamina', 'taquillas-metalicas'], 'product_cat', $product->get_id())) return;",
  "",
  "    $url = 'https://staging.zentrylockers.com/cerraduras-para-taquillas/';",
  "    echo '<div class=\"zentry-lock-crosssell\">",
  "        <div class=\"zentry-lock-crosssell__icon\">&#128274;</div>",
  "        <div class=\"zentry-lock-crosssell__body\">",
  "            <p class=\"zentry-lock-crosssell__title\">&iquest;Quieres una cerradura diferente?</p>",
  "            <p class=\"zentry-lock-crosssell__text\">Consulta las cerraduras disponibles para taquillas y elige la opci&oacute;n m&aacute;s adecuada para tu proyecto.</p>",
  "        </div>",
  "        <a class=\"zentry-lock-crosssell__btn\" href=\"' . esc_url($url) . '\">Ver cerraduras para taquillas</a>",
  "    </div>';",
  "}, 35);",
  "",
  "add_action('wp_head', function () {",
  "    if (!is_product()) return;",
  "    echo '<style>",
  "    .zentry-lock-crosssell{",
  "        display:flex; align-items:center; gap:1rem; flex-wrap:wrap;",
  "        margin:1.25rem 0; padding:1rem 1.25rem;",
  "        background:#eaf0ff; border:1px solid #b9cdfa; border-radius:10px;",
  "    }",
  "    .zentry-lock-crosssell__icon{ font-size:1.6rem; line-height:1; flex-shrink:0; }",
  "    .zentry-lock-crosssell__body{ flex:1 1 220px; min-width:180px; }",
  "    .zentry-lock-crosssell__title{ margin:0 0 .2rem; font-weight:700; color:#132a63; font-size:.98rem; }",
  "    .zentry-lock-crosssell__text{ margin:0; color:#3a4763; font-size:.88rem; line-height:1.4; }",
  "    .zentry-lock-crosssell__btn{",
  "        display:inline-block; flex-shrink:0; white-space:nowrap;",
  "        background:#2657d9; color:#fff !important; text-decoration:none;",
  "        font-weight:600; font-size:.88rem; padding:.6rem 1.1rem; border-radius:7px;",
  "        transition:background .15s ease;",
  "    }",
  "    .zentry-lock-crosssell__btn:hover{ background:#1c3fa0; }",
  "    @media (max-width:480px){",
  "        .zentry-lock-crosssell{ flex-direction:column; align-items:flex-start; }",
  "        .zentry-lock-crosssell__btn{ width:100%; text-align:center; }",
  "    }",
  "    </style>';",
  "});",
].join("\n");

const body = {
  name: "O33.2 - Cross-sell cerraduras en fichas de taquillas",
  desc:
    "Bloque visual junto a la zona de compra en fichas de taquillas, enlazando a /cerraduras-para-taquillas/. " +
    "Solo AÑADE contenido tras el resumen del producto (woocommerce_single_product_summary prioridad 35, " +
    "despues del formulario de compra que va a prioridad 30), nunca sustituye precio ni boton de compra. " +
    "Solo se muestra en categorias de taquillas. Fase O33.2 tarea 4 -- creado inactivo, se activa tras validar.",
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
