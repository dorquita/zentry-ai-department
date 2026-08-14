require("dotenv").config();
const fs = require("fs");

const prod = { auth: "Basic " + Buffer.from(process.env.WORDPRESS_PRODUCTION_USERNAME + ":" + process.env.WORDPRESS_PRODUCTION_APP_PASSWORD).toString("base64"), base: process.env.WORDPRESS_PRODUCTION_BASE_URL };

const FIXED_CODE = `add_action('wp_footer', function () {
    ?>
    <script>
    (function(){
      window.dataLayer = window.dataLayer || [];
      document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-zentry-event]') : null;
        if (!el) return;
        try {
          var eventName = el.getAttribute('data-zentry-event');
          window.dataLayer.push({
            event: eventName,
            page_url: window.location.href,
            page_title: document.title,
            origen: eventName,
            producto: el.getAttribute('data-zentry-producto') || '',
            categoria: el.getAttribute('data-zentry-categoria') || '',
            link_url: el.getAttribute('data-zentry-url') || window.location.href
          });
        } catch (err) { /* tracking must never break navigation */ }
      }, false);
    })();
    </script>
    <?php
}, 99);`;

async function main() {
  const r = await fetch(prod.base + "/wp-json/code-snippets/v1/snippets/22", {
    method: "PUT",
    headers: { Authorization: prod.auth, "Content-Type": "application/json" },
    body: JSON.stringify({ code: FIXED_CODE }),
  });
  const j = await r.json();
  console.log("update result:", JSON.stringify({ id: j.id, active: j.active, code_error: j.code_error }));
  fs.writeFileSync("/opt/zentry-ai-department/reports/o44-3-fix-result.json", JSON.stringify(j, null, 2));
}
main().catch((e) => console.error("FATAL", e.message));
