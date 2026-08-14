require("dotenv").config();

const base = process.env.WORDPRESS_STAGING_BASE_URL;

async function checkPage(url, label, checks) {
  const r = await fetch(`${base}${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`);
  const text = await r.text();
  const results = { label, url, status: r.status };
  results.phpError = /fatal error|parse error/i.test(text);
  results.hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(text);
  if (checks) {
    for (const [key, pattern] of Object.entries(checks)) {
      results[key] = typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
    }
  }
  console.log(JSON.stringify(results));
  return { text, results };
}

async function main() {
  console.log("=== FICHAS DE PRODUCTO (una por familia) ===");
  await checkPage("/product/taquilla-1-puertas-modulo-1-melamina/", "Melamina", {
    cta: "Solicita un presupuesto personalizado",
    crosssell: "zentry-lock-crosssell",
    addToCartBtn: "single_add_to_cart_button",
  });
  await checkPage("/product/taquilla-1-puerta-modulo-1-melamina-fenolico/", "Melamina-Fenólico", {
    cta: "Solicita un presupuesto personalizado",
    crosssell: "zentry-lock-crosssell",
    espesorSelector: /Espesor/i,
  });
  await checkPage("/product/taquilla-1-puerta-modulo-1-fenolica/", "Fenólica con perfilería", {
    cta: "Solicita un presupuesto personalizado",
    crosssell: "zentry-lock-crosssell",
    resbalonOption: "Cerradura de resbalón",
  });
  await checkPage("/product/taquilla-2-puertas-modulo-1-metalica/", "Metálica", {
    cta: "Solicita un presupuesto personalizado",
    crosssell: "zentry-lock-crosssell",
    bombilloOption: "Cerradura de bombillo",
  });
  await checkPage("/product/taquilla-1-puerta-modulo-1-metalica/", "Producto 334", {
    cta: "Solicita un presupuesto personalizado",
    crosssell: "zentry-lock-crosssell",
    bombillo194: "194,00",
  });
  await checkPage("/product/banco-vestuario-pino/", "Banco (fuera de alcance)", {
    cta: "Solicita un presupuesto personalizado",
    noCrosssell: (t) => !t.includes("zentry-lock-crosssell"),
  });

  console.log("\n=== CATEGORIAS ===");
  await checkPage("/product-category/taquillas-metalicas/", "Cat. Metálicas");
  await checkPage("/product-category/taquillas-de-melamina/", "Cat. Melamina");
  await checkPage("/product-category/taquillas-fenolicas/", "Cat. Fenólicas");
  await checkPage("/product-category/taquillas/", "Cat. Taquillas (general)");

  console.log("\n=== BUSCADOR ===");
  await checkPage("/?s=taquilla&post_type=product", "Buscador 'taquilla'");
  await checkPage("/?s=fenolica&post_type=product", "Buscador 'fenolica'");

  console.log("\n=== CHECKOUT (carga de pagina) ===");
  await checkPage("/checkout/", "Checkout");
  await checkPage("/carrito/", "Carrito (o /cart/)");
}

main().catch((e) => console.error("ERR", e.message));
