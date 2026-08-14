require("dotenv").config();
const fs = require("fs");

const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

const WHATSAPP_CODE_FIXED = `add_action('wp_footer', function () {
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
          if (!bannerEl) return false;
          var s = window.getComputedStyle(bannerEl);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          var r = bannerEl.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function sync(){
          if (bannerIsOpen()) { btn.classList.add('zentry-wa-hide'); }
          else { btn.classList.remove('zentry-wa-hide'); }
        }
        sync();
        if (bannerEl) {
          var observer = new MutationObserver(sync);
          observer.observe(bannerEl, { attributes: true, attributeFilter: ['class', 'style'] });
          setTimeout(sync, 500);
          setTimeout(sync, 1500);
        }
      } catch (e) { /* never break the page */ }
    })();
    </script>
    <?php
});`;

const STICKY_BAR_CODE_FIXED = `add_action('wp_footer', function () {
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
          if (!bannerEl) return false;
          var s = window.getComputedStyle(bannerEl);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          var r = bannerEl.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        function syncBanner(){
          if (bannerIsOpen()) { bar.classList.add('zentry-stickybar-hide'); }
          else { bar.classList.remove('zentry-stickybar-hide'); }
          applyHeight();
        }
        syncBanner();
        if (bannerEl) {
          var observer = new MutationObserver(syncBanner);
          observer.observe(bannerEl, { attributes: true, attributeFilter: ['class', 'style'] });
          setTimeout(syncBanner, 500);
          setTimeout(syncBanner, 1500);
        }
      } catch (e) { /* never break the page */ }
    })();
    </script>
    <?php
}, 90);`;

async function updateSnippet(id, fields) {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets/" + id, {
    method: "PUT",
    headers: { Authorization: staging.auth, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return await r.json();
}

async function main() {
  const wa = await updateSnippet(19, { code: WHATSAPP_CODE_FIXED });
  console.log("snippet 19 (WhatsApp) updated:", JSON.stringify({ id: wa.id, active: wa.active, code_error: wa.code_error }));

  const bar = await updateSnippet(22, { code: STICKY_BAR_CODE_FIXED });
  console.log("snippet 22 (sticky bar) updated:", JSON.stringify({ id: bar.id, active: bar.active, code_error: bar.code_error }));

  fs.writeFileSync("/opt/zentry-ai-department/reports/o40-2-fix-banner-detection-result.json", JSON.stringify({ wa, bar }, null, 2));
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
