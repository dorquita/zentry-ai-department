require("dotenv").config();
const fs = require("fs");

// STAGING ONLY. No production config object exists in this script on purpose.
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

const CSS_CODE = `add_action('wp_head', function () {
    echo '<style id="o40-zentry-cta-whatsapp">' . "
.zentry-cta-btn{display:inline-block;background:#2657d9;color:#ffffff !important;font-weight:600;font-size:.92rem;padding:10px 18px;border-radius:8px;text-decoration:none !important;transition:background .2s ease, transform .15s ease;line-height:1.3;}
.zentry-cta-btn:hover{background:#1c3fa0;transform:translateY(-1px);}
.zentry-cta-btn--compact{padding:8px 14px;font-size:.85rem;}
.zentry-price-cta--compact{margin:14px 0;}
.zentry-price-cta__text{font-size:.9rem;color:#374151;margin:0 0 8px 0;}
.zentry-cta-block{max-width:760px;margin:40px auto;padding:28px 30px;background:#f4f7ff;border:1px solid #dbe4ff;border-radius:16px;text-align:center;}
.zentry-cta-block__title{font-size:1.35rem;font-weight:700;color:#12203f;margin:0 0 10px 0;}
.zentry-cta-block__text{font-size:.98rem;color:#43506b;line-height:1.55;margin:0 0 20px 0;}
.zentry-whatsapp-float{position:fixed;bottom:20px;right:20px;background:#25D366;height:56px;border-radius:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding-right:0;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:99997;text-decoration:none !important;transition:transform .2s ease, opacity .2s ease;}
.zentry-whatsapp-float:hover{transform:scale(1.06);}
.zentry-whatsapp-float__icon{width:56px;height:56px;flex:0 0 56px;display:flex;align-items:center;justify-content:center;}
.zentry-whatsapp-float__label{display:none;color:#fff;font-weight:600;font-size:.85rem;white-space:nowrap;}
@media (min-width:783px){.zentry-whatsapp-float{padding-right:18px;}.zentry-whatsapp-float__label{display:inline-block;}}
.zentry-whatsapp-float.zentry-wa-hide{opacity:0;pointer-events:none;transform:translateY(10px);}
" . '</style>';
});`;

const WHATSAPP_CODE = `add_action('wp_footer', function () {
    $wa_number = '34630158767';

    if (function_exists('is_product') && is_product()) {
        global $product;
        $product_name = ($product instanceof WC_Product) ? $product->get_name() : get_the_title();
        $product_url  = get_permalink();
        $wa_text = 'Hola, quiero informacion sobre este producto: ' . $product_name . ' ' . $product_url;
    } else {
        $wa_text = 'Hola, quiero informacion sobre taquillas Zentry.';
    }

    $wa_url = 'https://wa.me/' . $wa_number . '?text=' . rawurlencode($wa_text);
    $current_url = home_url(add_query_arg(null, null));
    $producto_attr = (function_exists('is_product') && is_product()) ? esc_attr(get_the_title()) : '';

    echo '<a href="' . esc_url($wa_url) . '" class="zentry-whatsapp-float" target="_blank" rel="noopener noreferrer" aria-label="Hablar por WhatsApp"'
       . ' data-zentry-event="click_whatsapp_floating"'
       . ' data-zentry-url="' . esc_attr($current_url) . '"'
       . ' data-zentry-producto="' . $producto_attr . '">'
       . '<span class="zentry-whatsapp-float__icon"><svg viewBox="0 0 32 32" width="30" height="30" fill="#ffffff" aria-hidden="true"><path d="M16.001 3C9.373 3 4 8.373 4 15c0 2.386.7 4.607 1.908 6.475L4 29l7.719-1.869A11.94 11.94 0 0 0 16.001 27C22.629 27 28 21.627 28 15S22.629 3 16.001 3zm6.564 16.845c-.276.777-1.62 1.482-2.235 1.53-.575.045-1.062.257-3.593-.75-3.042-1.211-4.998-4.288-5.15-4.489-.15-.2-1.23-1.634-1.23-3.117 0-1.483.78-2.21 1.055-2.512.276-.302.6-.377.8-.377.2 0 .4.002.575.011.184.009.432-.07.676.516.276.66.936 2.278 1.019 2.443.083.166.138.36.028.578-.11.217-.166.353-.328.543-.166.19-.35.424-.5.57-.166.163-.34.34-.146.665.193.325.86 1.417 1.847 2.294 1.27 1.132 2.34 1.483 2.665 1.65.325.166.516.14.706-.083.19-.222.815-.95 1.033-1.276.217-.325.435-.27.734-.163.3.108 1.9.897 2.226 1.06.325.164.542.245.622.38.083.138.083.79-.19 1.567z"/></svg></span>'
       . '<span class="zentry-whatsapp-float__label">¿Necesitas ayuda?</span>'
       . '</a>';
    ?>
    <script>
    (function(){
      try {
        var btn = document.querySelector('.zentry-whatsapp-float');
        if (!btn) return;
        var bannerEl = document.querySelector('.cmplz-cookiebanner.optin');
        function bannerIsOpen(){
          return !!(bannerEl && !bannerEl.classList.contains('cmplz-hidden'));
        }
        function sync(){
          if (bannerIsOpen()) { btn.classList.add('zentry-wa-hide'); }
          else { btn.classList.remove('zentry-wa-hide'); }
        }
        sync();
        if (bannerEl) {
          var observer = new MutationObserver(sync);
          observer.observe(bannerEl, { attributes: true, attributeFilter: ['class'] });
        }
      } catch (e) { /* never break the page */ }
    })();
    </script>
    <?php
});`;

const LANDING_CTA_CODE = `add_filter('the_content', function ($content) {
    if (!is_singular('page') || !in_the_loop() || !is_main_query()) {
        return $content;
    }
    $landing_slugs = [
        'taquillas-melamina',
        'taquillas-fenolicas',
        'taquillas-fenolicas-perfileria',
        'taquillas-para-colegios',
        'taquillas-para-empresas',
        'cerraduras-para-taquillas',
        'digitalizacion-taquillas',
    ];
    global $post;
    if (!$post || !in_array($post->post_name, $landing_slugs, true)) {
        return $content;
    }

    $current_url = home_url(add_query_arg(null, null));
    $url = add_query_arg([
        'origen'    => 'cta_presupuesto_personalizado',
        'categoria' => $post->post_name,
        'url'       => rawurlencode($current_url),
    ], home_url('/contacto/'));

    $cta = '<div class="zentry-cta-block">'
         . '<p class="zentry-cta-block__title">Solicita tu presupuesto personalizado</p>'
         . '<p class="zentry-cta-block__text">¿Necesitas varias taquillas, cerraduras electrónicas o una configuración a medida? Te preparamos una propuesta personalizada según medidas, cantidades, cerraduras y plazo de entrega.</p>'
         . '<a class="zentry-cta-btn" href="' . esc_url($url) . '" data-zentry-event="click_presupuesto_personalizado" data-zentry-categoria="' . esc_attr($post->post_name) . '" data-zentry-url="' . esc_attr($current_url) . '">Solicitar presupuesto personalizado</a>'
         . '</div>';

    return $content . $cta;
}, 20);`;

const TRACKING_CODE = `add_action('wp_footer', function () {
    ?>
    <script>
    (function(){
      document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-zentry-event]') : null;
        if (!el) return;
        try {
          var eventName = el.getAttribute('data-zentry-event');
          var payload = {
            page_location: window.location.href,
            page_title: document.title,
            producto: el.getAttribute('data-zentry-producto') || '',
            categoria: el.getAttribute('data-zentry-categoria') || '',
            link_url: el.getAttribute('data-zentry-url') || window.location.href
          };
          if (typeof gtag === 'function') {
            gtag('event', eventName, payload);
          } else if (window.dataLayer && typeof window.dataLayer.push === 'function') {
            window.dataLayer.push(Object.assign({ event: eventName }, payload));
          }
        } catch (err) { /* tracking must never break navigation */ }
      }, false);
    })();
    </script>
    <?php
}, 99);`;

const UPDATED_SNIPPET_15_CODE = `add_action('woocommerce_after_add_to_cart_button', function () {
    global $product;
    if (!$product instanceof WC_Product) return;

    $current_url = home_url(add_query_arg(null, null));
    $url = add_query_arg([
        'origen'          => 'cta_presupuesto_personalizado',
        'producto_id'     => $product->get_id(),
        'producto_slug'   => $product->get_slug(),
        'producto_nombre' => rawurlencode($product->get_name()),
        'ubicacion'       => 'ficha_producto',
        'url'             => rawurlencode($current_url),
    ], home_url('/contacto/'));

    echo '<div class="zentry-price-cta zentry-price-cta--compact">'
       . '<p class="zentry-price-cta__text">¿Necesitas varias unidades, instalación o un proyecto a medida?</p>'
       . '<a class="zentry-cta-btn zentry-cta-btn--compact" href="' . esc_url($url) . '" data-zentry-event="click_presupuesto_personalizado" data-zentry-producto="' . esc_attr($product->get_name()) . '" data-zentry-url="' . esc_attr($current_url) . '">Solicitar presupuesto personalizado</a>'
       . '</div>';
});

add_action('woocommerce_after_shop_loop_item', function () {
    global $product;
    if (!$product instanceof WC_Product) return;
    $current_url = home_url(add_query_arg(null, null));
    $url = add_query_arg([
        'origen'          => 'cta_presupuesto_personalizado',
        'producto_id'     => $product->get_id(),
        'producto_slug'   => $product->get_slug(),
        'producto_nombre' => rawurlencode($product->get_name()),
        'ubicacion'       => 'categoria',
        'url'             => rawurlencode($current_url),
    ], home_url('/contacto/'));
    echo '<a class="zentry-cta-btn zentry-cta-btn--compact" href="' . esc_url($url) . '" data-zentry-event="click_presupuesto_personalizado" data-zentry-producto="' . esc_attr($product->get_name()) . '" data-zentry-url="' . esc_attr($current_url) . '">Proyecto a medida →</a>';
}, 25);`;

async function createSnippet(name, desc, code) {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets", {
    method: "POST",
    headers: { Authorization: staging.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name, desc, code, scope: "front-end", active: false }),
  });
  return await r.json();
}
async function activateSnippet(id) {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets/" + id, {
    method: "PUT",
    headers: { Authorization: staging.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ active: true }),
  });
  return await r.json();
}
async function updateSnippet(id, fields) {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets/" + id, {
    method: "PUT",
    headers: { Authorization: staging.auth, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return await r.json();
}

async function main() {
  const results = {};

  // 1. CSS (create inactive, validate, then activate)
  const css = await createSnippet("O40 - CSS CTA presupuesto + WhatsApp - STAGING", "Estilos aislados para el CTA de presupuesto personalizado y el boton flotante de WhatsApp. Fase O40.", CSS_CODE);
  results.css_created = { id: css.id, code_error: css.code_error };
  console.log("CSS created:", JSON.stringify(results.css_created));

  // 2. WhatsApp floating
  const wa = await createSnippet("O40 - WhatsApp flotante - STAGING", "Boton flotante de WhatsApp fijo abajo a la derecha, numero real 34630158767 (confirmado activo en pagina Contacto de produccion), mensaje dinamico segun producto, se oculta mientras el banner de cookies Complianz esta visible. Fase O40.", WHATSAPP_CODE);
  results.wa_created = { id: wa.id, code_error: wa.code_error };
  console.log("WhatsApp created:", JSON.stringify(results.wa_created));

  // 3. Landing CTA
  const landing = await createSnippet("O40 - CTA presupuesto personalizado (landings) - STAGING", "CTA de presupuesto personalizado (titulo + texto + boton) anadido al final del contenido de las 7 landings comerciales: taquillas-melamina, taquillas-fenolicas, taquillas-fenolicas-perfileria, taquillas-para-colegios, taquillas-para-empresas, cerraduras-para-taquillas, digitalizacion-taquillas. Fase O40.", LANDING_CTA_CODE);
  results.landing_created = { id: landing.id, code_error: landing.code_error };
  console.log("Landing CTA created:", JSON.stringify(results.landing_created));

  // 4. Tracking JS
  const tracking = await createSnippet("O40 - JS tracking CTA + WhatsApp - STAGING", "Listener delegado de clicks sobre [data-zentry-event] (CTA presupuesto y WhatsApp flotante), envia evento via gtag() si existe o dataLayer.push como fallback. No activa conversiones ni campanas de Ads. Fase O40.", TRACKING_CODE);
  results.tracking_created = { id: tracking.id, code_error: tracking.code_error };
  console.log("Tracking created:", JSON.stringify(results.tracking_created));

  const allOk = [css, wa, landing, tracking].every((s) => s.code_error === null && s.id);
  if (!allOk) {
    console.log("\nABORTING activation - one or more snippets had a code_error on creation. Nothing was activated.");
    fs.writeFileSync("/opt/zentry-ai-department/reports/o40-deploy-result.json", JSON.stringify({ results, activated: false }, null, 2));
    return;
  }

  // activate all 4 new ones
  for (const [key, s] of [["css", css], ["wa", wa], ["landing", landing], ["tracking", tracking]]) {
    const act = await activateSnippet(s.id);
    console.log("activated", key, "id", act.id, "active:", act.active, "code_error:", act.code_error);
    results[key + "_activated"] = { id: act.id, active: act.active, code_error: act.code_error };
  }

  // 5. update existing snippet #15
  const updated15 = await updateSnippet(15, { code: UPDATED_SNIPPET_15_CODE, name: "O33/O40 - CTA presupuesto personalizado (ficha + categoria, actualizado O40) - STAGING" });
  console.log("\nsnippet 15 updated:", JSON.stringify({ id: updated15.id, active: updated15.active, code_error: updated15.code_error }));
  results.snippet15_updated = { id: updated15.id, active: updated15.active, code_error: updated15.code_error };

  fs.writeFileSync("/opt/zentry-ai-department/reports/o40-deploy-result.json", JSON.stringify({ results, activated: true }, null, 2));
  console.log("\n=== DONE. Full result saved to reports/o40-deploy-result.json ===");
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
