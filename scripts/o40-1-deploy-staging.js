require("dotenv").config();
const fs = require("fs");

// STAGING ONLY. No production config object exists in this script on purpose.
const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

const STICKY_BAR_CODE = `add_action('wp_footer', function () {
    if (function_exists('is_cart') && is_cart()) return;
    if (function_exists('is_checkout') && is_checkout()) return;
    if (is_page('contacto')) return;

    $current_url = home_url(add_query_arg(null, null));
    $url = add_query_arg(['origen' => 'sticky_presupuesto_personalizado'], home_url('/contacto/'));

    echo '<style id="o40-1-zentry-stickybar">' . "
.zentry-sticky-bar{position:fixed;left:0;right:0;bottom:0;z-index:99995;background:#2657d9;color:#ffffff;box-shadow:0 -4px 14px rgba(0,0,0,.15);transition:transform .25s ease, opacity .25s ease;}
.zentry-sticky-bar__inner{max-width:1200px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;text-align:center;}
.zentry-sticky-bar__text{font-size:.95rem;font-weight:500;margin:0;line-height:1.35;}
.zentry-sticky-bar__text--short{display:none;}
.zentry-sticky-bar__btn{display:inline-block;background:#F7B500;color:#14213d !important;font-weight:700;font-size:.9rem;padding:10px 20px;border-radius:8px;text-decoration:none !important;white-space:nowrap;transition:background .2s ease, transform .15s ease;}
.zentry-sticky-bar__btn:hover{background:#e0a400;transform:translateY(-1px);}
.zentry-sticky-bar.zentry-stickybar-hide{transform:translateY(110%);opacity:0;pointer-events:none;}
body.zentry-has-stickybar{padding-bottom:var(--zentry-stickybar-h,0px);}
@media (max-width:600px){
.zentry-sticky-bar__inner{padding:10px 14px;gap:10px;}
.zentry-sticky-bar__text--full{display:none;}
.zentry-sticky-bar__text--short{display:block;}
.zentry-sticky-bar__text{font-size:.82rem;}
.zentry-sticky-bar__btn{padding:9px 14px;font-size:.82rem;}
}
" . '</style>';

    echo '<div class="zentry-sticky-bar" id="zentry-sticky-bar">'
       . '<div class="zentry-sticky-bar__inner">'
       . '<p class="zentry-sticky-bar__text zentry-sticky-bar__text--full">¿Proyecto de grandes volúmenes? Obtén precios especiales y asesoría profesional</p>'
       . '<p class="zentry-sticky-bar__text zentry-sticky-bar__text--short">Proyectos grandes: precios especiales</p>'
       . '<a class="zentry-sticky-bar__btn" href="' . esc_url($url) . '" data-zentry-event="sticky_presupuesto_click" data-zentry-url="' . esc_attr($current_url) . '">PIDE ASESORAMIENTO Y PRECIO</a>'
       . '</div>'
       . '</div>';
    ?>
    <script>
    (function(){
      try {
        var bar = document.getElementById('zentry-sticky-bar');
        if (!bar) return;
        document.body.classList.add('zentry-has-stickybar');

        function applyHeight(){
          var h = bar.offsetHeight;
          document.documentElement.style.setProperty('--zentry-stickybar-h', h + 'px');
        }
        applyHeight();
        if (window.ResizeObserver) {
          new ResizeObserver(applyHeight).observe(bar);
        } else {
          window.addEventListener('resize', applyHeight);
        }

        var bannerEl = document.querySelector('.cmplz-cookiebanner.optin');
        function bannerIsOpen(){
          return !!(bannerEl && !bannerEl.classList.contains('cmplz-hidden'));
        }
        function syncBanner(){
          if (bannerIsOpen()) { bar.classList.add('zentry-stickybar-hide'); }
          else { bar.classList.remove('zentry-stickybar-hide'); }
        }
        syncBanner();
        if (bannerEl) {
          var observer = new MutationObserver(syncBanner);
          observer.observe(bannerEl, { attributes: true, attributeFilter: ['class'] });
        }
      } catch (e) { /* never break the page */ }
    })();
    </script>
    <?php
}, 90);`;

const UPDATED_CSS_18 = `add_action('wp_head', function () {
    echo '<style id="o40-zentry-cta-whatsapp">' . "
.zentry-cta-btn{display:inline-block;background:#2657d9;color:#ffffff !important;font-weight:600;font-size:.92rem;padding:10px 18px;border-radius:8px;text-decoration:none !important;transition:background .2s ease, transform .15s ease;line-height:1.3;}
.zentry-cta-btn:hover{background:#1c3fa0;transform:translateY(-1px);}
.zentry-cta-btn--compact{padding:8px 14px;font-size:.85rem;}
.zentry-price-cta--compact{margin:14px 0;}
.zentry-price-cta__text{font-size:.9rem;color:#374151;margin:0 0 8px 0;}
.zentry-cta-block{max-width:760px;margin:40px auto;padding:28px 30px;background:#f4f7ff;border:1px solid #dbe4ff;border-radius:16px;text-align:center;}
.zentry-cta-block__title{font-size:1.35rem;font-weight:700;color:#12203f;margin:0 0 10px 0;}
.zentry-cta-block__text{font-size:.98rem;color:#43506b;line-height:1.55;margin:0 0 20px 0;}
.zentry-whatsapp-float{position:fixed;bottom:calc(20px + var(--zentry-stickybar-h,0px));right:20px;background:#25D366;height:56px;border-radius:28px;display:flex;align-items:center;justify-content:center;gap:8px;padding-right:0;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:99997;text-decoration:none !important;transition:transform .2s ease, opacity .2s ease, bottom .2s ease;}
.zentry-whatsapp-float:hover{transform:scale(1.06);}
.zentry-whatsapp-float__icon{width:56px;height:56px;flex:0 0 56px;display:flex;align-items:center;justify-content:center;}
.zentry-whatsapp-float__label{display:none;color:#fff;font-weight:600;font-size:.85rem;white-space:nowrap;}
@media (min-width:783px){.zentry-whatsapp-float{padding-right:18px;}.zentry-whatsapp-float__label{display:inline-block;}}
.zentry-whatsapp-float.zentry-wa-hide{opacity:0;pointer-events:none;transform:translateY(10px);}
" . '</style>';
});`;

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

  const bar = await createSnippet(
    "O40.1 - Sticky CTA presupuesto inferior - STAGING",
    "Barra fija inferior tipo Taquiblock (fondo azul Zentry, boton amarillo 'PIDE ASESORAMIENTO Y PRECIO' -> /contacto/?origen=sticky_presupuesto_personalizado). Oculta en carrito/checkout/contacto. Se oculta junto con el banner de cookies Complianz. Desplaza el boton flotante de WhatsApp hacia arriba via variable CSS --zentry-stickybar-h (medida dinamicamente con ResizeObserver). Tracking sticky_presupuesto_click reutiliza el listener delegado ya existente ([data-zentry-event]) de la Fase O40. Fase O40.1.",
    STICKY_BAR_CODE
  );
  results.bar_created = { id: bar.id, code_error: bar.code_error };
  console.log("Sticky bar created:", JSON.stringify(results.bar_created));

  if (bar.code_error !== null || !bar.id) {
    console.log("\nABORTING - sticky bar snippet had a code_error on creation. Nothing activated, CSS 18 not touched.");
    fs.writeFileSync("/opt/zentry-ai-department/reports/o40-1-deploy-result.json", JSON.stringify({ results, activated: false }, null, 2));
    return;
  }

  const act = await activateSnippet(bar.id);
  console.log("activated bar id", act.id, "active:", act.active, "code_error:", act.code_error);
  results.bar_activated = { id: act.id, active: act.active, code_error: act.code_error };

  if (act.code_error !== null || act.active !== true) {
    console.log("\nABORTING before touching CSS 18 - activation of sticky bar was not clean.");
    fs.writeFileSync("/opt/zentry-ai-department/reports/o40-1-deploy-result.json", JSON.stringify({ results, activated: false }, null, 2));
    return;
  }

  const updated18 = await updateSnippet(18, { code: UPDATED_CSS_18 });
  console.log("\nsnippet 18 (CSS) updated:", JSON.stringify({ id: updated18.id, active: updated18.active, code_error: updated18.code_error }));
  results.snippet18_updated = { id: updated18.id, active: updated18.active, code_error: updated18.code_error };

  fs.writeFileSync("/opt/zentry-ai-department/reports/o40-1-deploy-result.json", JSON.stringify({ results, activated: true }, null, 2));
  console.log("\n=== DONE. Full result saved to reports/o40-1-deploy-result.json ===");
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
