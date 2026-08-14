require("dotenv").config();
const fs = require("fs");

const staging = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_USERNAME + ":" + process.env.WORDPRESS_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_STAGING_BASE_URL };

// ---- #19 WhatsApp: text change + same visibility logic (unchanged) ----
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
       . '<span class="zentry-whatsapp-float__icon"><svg viewBox="0 0 32 32" width="28" height="28" fill="#ffffff" aria-hidden="true"><path d="M16.001 3C9.373 3 4 8.373 4 15c0 2.386.7 4.607 1.908 6.475L4 29l7.719-1.869A11.94 11.94 0 0 0 16.001 27C22.629 27 28 21.627 28 15S22.629 3 16.001 3zm6.564 16.845c-.276.777-1.62 1.482-2.235 1.53-.575.045-1.062.257-3.593-.75-3.042-1.211-4.998-4.288-5.15-4.489-.15-.2-1.23-1.634-1.23-3.117 0-1.483.78-2.21 1.055-2.512.276-.302.6-.377.8-.377.2 0 .4.002.575.011.184.009.432-.07.676.516.276.66.936 2.278 1.019 2.443.083.166.138.36.028.578-.11.217-.166.353-.328.543-.166.19-.35.424-.5.57-.166.163-.34.34-.146.665.193.325.86 1.417 1.847 2.294 1.27 1.132 2.34 1.483 2.665 1.65.325.166.516.14.706-.083.19-.222.815-.95 1.033-1.276.217-.325.435-.27.734-.163.3.108 1.9.897 2.226 1.06.325.164.542.245.622.38.083.138.083.79-.19 1.567z"/></svg></span>'
       . '<span class="zentry-whatsapp-float__label">Te respondemos rápido</span>'
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

// ---- #22 Sticky bar: refined copy/style + scroll-reveal ----
const STICKY_BAR_CODE = `add_action('wp_footer', function () {
    if (function_exists('is_cart') && is_cart()) return;
    if (function_exists('is_checkout') && is_checkout()) return;
    if (is_page('contacto')) return;

    $current_url = home_url(add_query_arg(null, null));
    $url = add_query_arg(['origen' => 'sticky_presupuesto_personalizado'], home_url('/contacto/'));
    $threshold = (function_exists('is_front_page') && is_front_page()) ? 350 : 120;

    echo '<style id="o40-1-zentry-stickybar">' . "
.zentry-sticky-bar{position:fixed;left:0;right:0;bottom:0;z-index:99995;background:#2657d9;color:#ffffff;box-shadow:0 -3px 10px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.08);transition:transform .3s ease, opacity .3s ease;}
.zentry-sticky-bar__inner{max-width:1200px;margin:0 auto;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;text-align:center;}
.zentry-sticky-bar__text{font-size:.88rem;font-weight:500;margin:0;line-height:1.3;letter-spacing:.1px;}
.zentry-sticky-bar__text--short{display:none;}
.zentry-sticky-bar__btn{display:inline-block;background:#F7B500;color:#14213d !important;font-weight:700;font-size:.82rem;letter-spacing:.2px;padding:8px 18px;border-radius:6px;text-decoration:none !important;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.15);transition:background .2s ease, transform .15s ease, box-shadow .2s ease;}
.zentry-sticky-bar__btn:hover{background:#e0a400;transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,0,0,.2);}
.zentry-sticky-bar__btn--mobile{display:none;}
.zentry-sticky-bar.zentry-stickybar-hide{transform:translateY(110%);opacity:0;pointer-events:none;}
body.zentry-has-stickybar{padding-bottom:var(--zentry-stickybar-h,0px);}
@media (max-width:600px){
.zentry-sticky-bar__inner{padding:9px 14px;gap:8px;}
.zentry-sticky-bar__text--full{display:none;}
.zentry-sticky-bar__text--short{display:block;}
.zentry-sticky-bar__text{font-size:.78rem;}
.zentry-sticky-bar__btn{padding:7px 14px;font-size:.76rem;}
.zentry-sticky-bar__btn--desktop{display:none;}
.zentry-sticky-bar__btn--mobile{display:inline-block;}
}
" . '</style>';

    echo '<div class=\"zentry-sticky-bar zentry-stickybar-hide\" id=\"zentry-sticky-bar\" data-scroll-threshold=\"' . intval($threshold) . '\">'
       . '<div class=\"zentry-sticky-bar__inner\">'
       . '<p class=\"zentry-sticky-bar__text zentry-sticky-bar__text--full\">¿Proyecto de grandes volúmenes? Precios especiales y asesoría profesional</p>'
       . '<p class=\"zentry-sticky-bar__text zentry-sticky-bar__text--short\">Precios especiales para proyectos</p>'
       . '<a class=\"zentry-sticky-bar__btn zentry-sticky-bar__btn--desktop\" href=\"' . esc_url($url) . '\" data-zentry-event=\"sticky_presupuesto_click\" data-zentry-url=\"' . esc_attr($current_url) . '\">PIDE ASESORAMIENTO Y PRECIO</a>'
       . '<a class=\"zentry-sticky-bar__btn zentry-sticky-bar__btn--mobile\" href=\"' . esc_url($url) . '\" data-zentry-event=\"sticky_presupuesto_click\" data-zentry-url=\"' . esc_attr($current_url) . '\">PEDIR PRECIO</a>'
       . '</div>'
       . '</div>';
    ?>
    <script>
    (function(){
      try {
        var bar = document.getElementById('zentry-sticky-bar');
        if (!bar) return;
        document.body.classList.add('zentry-has-stickybar');

        var threshold = parseInt(bar.getAttribute('data-scroll-threshold'), 10) || 0;
        var scrolledEnough = threshold <= 0;
        var bannerEl = document.querySelector('.cmplz-cookiebanner.optin');

        function applyHeight(){
          var h = bar.offsetHeight;
          document.documentElement.style.setProperty('--zentry-stickybar-h', h + 'px');
        }

        function bannerIsOpen(){
          if (!bannerEl) return false;
          var s = window.getComputedStyle(bannerEl);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          var r = bannerEl.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        function sync(){
          var shouldHide = bannerIsOpen() || !scrolledEnough;
          if (shouldHide) { bar.classList.add('zentry-stickybar-hide'); }
          else { bar.classList.remove('zentry-stickybar-hide'); }
          applyHeight();
        }

        function onScroll(){
          if (!scrolledEnough && window.scrollY >= threshold) {
            scrolledEnough = true;
            sync();
          }
        }

        applyHeight();
        sync();
        if (!scrolledEnough) {
          window.addEventListener('scroll', onScroll, { passive: true });
          onScroll();
        }
        if (window.ResizeObserver) {
          new ResizeObserver(applyHeight).observe(bar);
        } else {
          window.addEventListener('resize', applyHeight);
        }
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
}, 90);`;

// ---- #18 shared CSS: WhatsApp visual polish (softer shadow, slightly smaller, more gap) ----
const CSS_18 = `add_action('wp_head', function () {
    echo '<style id="o40-zentry-cta-whatsapp">' . "
.zentry-cta-btn{display:inline-block;background:#2657d9;color:#ffffff !important;font-weight:600;font-size:.92rem;padding:10px 18px;border-radius:8px;text-decoration:none !important;transition:background .2s ease, transform .15s ease;line-height:1.3;}
.zentry-cta-btn:hover{background:#1c3fa0;transform:translateY(-1px);}
.zentry-cta-btn--compact{padding:8px 14px;font-size:.85rem;}
.zentry-price-cta--compact{margin:14px 0;}
.zentry-price-cta__text{font-size:.9rem;color:#374151;margin:0 0 8px 0;}
.zentry-cta-block{max-width:760px;margin:40px auto;padding:28px 30px;background:#f4f7ff;border:1px solid #dbe4ff;border-radius:16px;text-align:center;}
.zentry-cta-block__title{font-size:1.35rem;font-weight:700;color:#12203f;margin:0 0 10px 0;}
.zentry-cta-block__text{font-size:.98rem;color:#43506b;line-height:1.55;margin:0 0 20px 0;}
.zentry-whatsapp-float{position:fixed;bottom:calc(24px + var(--zentry-stickybar-h,0px));right:20px;background:#25D366;height:52px;border-radius:26px;display:flex;align-items:center;justify-content:center;gap:8px;padding-right:0;box-shadow:0 3px 10px rgba(0,0,0,.18);z-index:99997;text-decoration:none !important;transition:transform .2s ease, opacity .2s ease, bottom .2s ease, box-shadow .2s ease;}
.zentry-whatsapp-float:hover{transform:scale(1.05);box-shadow:0 4px 14px rgba(0,0,0,.22);}
.zentry-whatsapp-float__icon{width:52px;height:52px;flex:0 0 52px;display:flex;align-items:center;justify-content:center;}
.zentry-whatsapp-float__label{display:none;color:#fff;font-weight:600;font-size:.82rem;white-space:nowrap;}
@media (min-width:783px){.zentry-whatsapp-float{padding-right:16px;}.zentry-whatsapp-float__label{display:inline-block;}}
.zentry-whatsapp-float.zentry-wa-hide{opacity:0;pointer-events:none;transform:translateY(10px);}
" . '</style>';
});`;

// ---- new: hero refinement, scoped only to home hero block classes ----
const HERO_CODE = `add_action('wp_head', function () {
    if (!(function_exists('is_front_page') && is_front_page())) return;
    echo '<style id=\"o40-3-hero-refine\">' . "
@media (min-width:1024px){
.kt-adv-heading1878_hero-a3{font-size:56px !important;margin-bottom:26px !important;}
.kt-adv-heading1878_hero-a4{margin-bottom:34px !important;}
}
" . '</style>';
}, 20);`;

async function updateSnippet(id, fields) {
  const r = await fetch(staging.base + "/wp-json/code-snippets/v1/snippets/" + id, {
    method: "PUT",
    headers: { Authorization: staging.auth, "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return await r.json();
}
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

async function main() {
  const results = {};

  const hero = await createSnippet(
    "O40.3 - Hero refinamiento visual - STAGING",
    "Reduce el H1 del hero de home ~13% en desktop (64px->56px) y ajusta el espaciado hacia el subtitulo, solo en is_front_page(), usando las clases especificas del bloque Kadence (kt-adv-heading1878_hero-a3/a4) para no afectar a ningun otro H1 del sitio. Fase O40.3.",
    HERO_CODE
  );
  results.hero_created = { id: hero.id, code_error: hero.code_error };
  console.log("hero snippet created:", JSON.stringify(results.hero_created));

  if (hero.code_error !== null || !hero.id) {
    console.log("ABORTING - hero snippet code_error, nothing else touched.");
    fs.writeFileSync("/opt/zentry-ai-department/reports/o40-3-deploy-result.json", JSON.stringify({ results, ok: false }, null, 2));
    return;
  }
  const heroAct = await activateSnippet(hero.id);
  console.log("hero snippet activated:", JSON.stringify({ id: heroAct.id, active: heroAct.active, code_error: heroAct.code_error }));
  results.hero_activated = heroAct;

  const wa = await updateSnippet(19, { code: WHATSAPP_CODE });
  console.log("snippet 19 (WhatsApp) updated:", JSON.stringify({ id: wa.id, active: wa.active, code_error: wa.code_error }));
  results.wa_updated = wa;

  const bar = await updateSnippet(22, { code: STICKY_BAR_CODE });
  console.log("snippet 22 (sticky bar) updated:", JSON.stringify({ id: bar.id, active: bar.active, code_error: bar.code_error }));
  results.bar_updated = bar;

  const css = await updateSnippet(18, { code: CSS_18 });
  console.log("snippet 18 (CSS) updated:", JSON.stringify({ id: css.id, active: css.active, code_error: css.code_error }));
  results.css_updated = css;

  const anyError = [wa, bar, css].some((s) => s.code_error !== null);
  fs.writeFileSync("/opt/zentry-ai-department/reports/o40-3-deploy-result.json", JSON.stringify({ results, ok: !anyError }, null, 2));
  console.log("\n=== DONE. any_error:", anyError, "===");
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
