require("dotenv").config();

const user = process.env.WORDPRESS_USERNAME;
const pass = process.env.WORDPRESS_APP_PASSWORD;
const base = process.env.WORDPRESS_STAGING_BASE_URL;
const auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

const code = [
  "add_action('woocommerce_after_add_to_cart_button', function () {",
  "    global $product;",
  "    if (!$product instanceof WC_Product) return;",
  "",
  "    $url = add_query_arg([",
  "        'origen'          => 'cta_proyecto_medida',",
  "        'producto_id'     => $product->get_id(),",
  "        'producto_slug'   => $product->get_slug(),",
  "        'producto_nombre' => rawurlencode($product->get_name()),",
  "        'ubicacion'       => 'ficha_producto',",
  "    ], home_url('/contacto/'));",
  "",
  "    echo '<div class=\"zentry-price-cta zentry-price-cta--compact\"><p class=\"zentry-price-cta__text\">¿Necesitas varias unidades, instalación o un proyecto a medida? <a href=\"' . esc_url($url) . '\">Solicita un presupuesto personalizado</a>.</p></div>';",
  "});",
  "",
  "add_action('woocommerce_after_shop_loop_item', function () {",
  "    global $product;",
  "    if (!$product instanceof WC_Product) return;",
  "    $url = add_query_arg([",
  "        'origen' => 'cta_proyecto_medida',",
  "        'producto_id' => $product->get_id(),",
  "        'producto_slug' => $product->get_slug(),",
  "        'producto_nombre' => rawurlencode($product->get_name()),",
  "        'ubicacion' => 'categoria',",
  "    ], home_url('/contacto/'));",
  "    echo '<a class=\"zentry-price-cta__link-compact\" href=\"' . esc_url($url) . '\">Proyecto a medida →</a>';",
  "}, 25);",
].join("\n");

const body = {
  name: "O33 - CTA presupuesto proyecto a medida (recuperado tras O32.7)",
  desc:
    "Recupera el CTA de presupuesto perdido al quitar zentry-hide-prices-guests.php. Solo AÑADE contenido " +
    "(woocommerce_after_add_to_cart_button / woocommerce_after_shop_loop_item), nunca sustituye precio ni " +
    "formulario de compra. Fase O33 tarea 0 -- creado inactivo a proposito, se activa en un paso aparte tras revisar.",
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
    console.log("STATUS", r.status);
    console.log(await r.text());
  })
  .catch((e) => console.error("ERR", e.message));
