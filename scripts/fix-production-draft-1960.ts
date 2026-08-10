import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getProductionPage, getProductionStatusForReport, updateProductionDraftPage } from "../src/adapters/wordpress-production";
import { recordPendingProductionDraftEdit, markProductionDraftEditFailed } from "../src/core/production-draft-edits";
import { logger } from "../src/core/logger";

/**
 * Correccion puntual (Fase O13.5) del draft de PRODUCCION 1960: rellena
 * las 3 secciones vacias, elimina el texto de placeholder de las FAQ,
 * anade un CTA con enlaces/telefono REALES ya publicados en la propia
 * web (nunca inventados), y fija el slug. Guarda snapshot completo
 * previo (title/content/excerpt/slug) ANTES de escribir. Mantiene
 * SIEMPRE status "draft" -- nunca publica.
 */

const PAGE_ID = 1960;
const NEW_SLUG = "taquillas-escolares";

const NEW_CONTENT_HTML = `<!-- wp:image {"id":1959,"sizeSlug":"large","linkDestination":"none","className":"hero-image"} -->
<figure class="wp-block-image size-large hero-image"><img src="https://zentrylockers.com/wp-content/uploads/2026/08/taquillas-escolares-hero-zentry.webp" alt="Taquillas escolares — imagen principal" class="wp-image-1959"/></figure>
<!-- /wp:image -->

<h1>Taquillas Escolares</h1>
<p>En Zentry fabricamos y vendemos directamente taquillas escolares, con envio rapido y precios competitivos al ser fabricante. Elige entre distintos materiales y medidas segun tu espacio y presupuesto.</p>
<h2>Modelos y medidas disponibles</h2>
<p>Disponemos de taquillas escolares en distintas configuraciones -- de un solo compartimento o multicompartimento -- para adaptarnos al espacio disponible en pasillos, vestuarios o zonas comunes de tu centro. Cuentanos tu caso concreto y te proponemos la combinacion de medidas mas adecuada para tu colegio.</p>
<h2>Materiales: metalica, fenolica o melamina</h2>
<p>Fabricamos taquillas en tres materiales principales, cada uno pensado para necesidades distintas: <strong>metalica</strong>, la opcion mas robusta y duradera para un uso intensivo; <strong>fenolica</strong>, resistente a la humedad y especialmente indicada para vestuarios y zonas humedas; y <strong>melamina</strong>, una alternativa mas economica con acabado tipo madera, ideal para espacios comunes y zonas de menor exigencia.</p>
<h2>Precios y presupuesto sin compromiso</h2>
<p>Al ser fabricante directo, ofrecemos precios competitivos sin intermediarios. Cada centro escolar tiene necesidades distintas de numero de taquillas, materiales y medidas, asi que preparamos un presupuesto a medida sin compromiso -- solo tienes que contarnos que necesitas.</p>
<h2>Preguntas frecuentes sobre taquillas escolares</h2>
<h3>¿Cuanto tarda la entrega?</h3>
<p>El plazo de entrega depende del volumen del pedido y del grado de personalizacion. Al ser fabricante directo solemos ofrecer plazos mas ajustados que un intermediario -- te confirmamos el plazo exacto para tu pedido al preparar el presupuesto.</p>
<h3>¿Que garantia tienen las taquillas?</h3>
<p>Todas las taquillas Zentry cuentan con garantia de fabricante. Te detallamos las condiciones exactas aplicables a tu pedido junto con el presupuesto.</p>

<h2>Solicita presupuesto sin compromiso</h2>
<p>Cuentanos cuantas taquillas necesitas y para que espacio, y te preparamos una propuesta a medida sin compromiso.</p>
<ul>
<li><a href="https://zentrylockers.com/solicitar-presupuesto/">Solicitar presupuesto</a></li>
<li><a href="https://zentrylockers.com/contacto/">Contactar por formulario</a></li>
<li>Llamar al <a href="tel:+34644456242">+34 644 45 62 42</a></li>
</ul>`;

function plainPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const prodStatus = getProductionStatusForReport();
  console.log("=== Correccion del draft de produccion 1960 (Fase O13.5) ===");
  console.log(`PRODUCTION_EXECUTION_ENABLED=${prodStatus.executionEnabled} PRODUCTION_DRAFTS_ENABLED=${prodStatus.draftsEnabled} PRODUCTION_BACKEND=${prodStatus.backend}`);
  console.log(`canWrite: ${prodStatus.canWrite}`);
  console.log("");

  if (!prodStatus.canWrite) {
    console.log("SIMULACION (no se toca la red): faltan una o mas de las 3 condiciones. No se modifica nada.");
    return;
  }

  const current = await getProductionPage(PAGE_ID);
  console.log(`Estado actual: status="${current.status}" title="${current.title}" slug="${current.slug || "(vacio)"}"`);
  if (current.status !== "draft") {
    console.error(`La pagina ${PAGE_ID} no esta en status "draft" (esta en "${current.status}"). Bloqueado: no se toca.`);
    process.exit(1);
    return;
  }

  const answer = await plainPrompt(
    `Vas a ACTUALIZAR el draft de PRODUCCION ${PAGE_ID}: rellenar secciones vacias, quitar placeholders, reescribir FAQ, anadir CTA (enlaces reales ya publicados), fijar slug="${NEW_SLUG}". Sigue en status "draft", NO se publica. Escribe "si" para confirmar: `
  );
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario. No se modifico nada.");
    return;
  }

  const edit = recordPendingProductionDraftEdit({
    pageId: PAGE_ID,
    previousTitle: current.title,
    previousContentHtml: current.contentHtml,
    previousExcerpt: current.excerpt,
    previousSlug: current.slug,
    newTitle: current.title,
    newContentHtml: NEW_CONTENT_HTML,
    newExcerpt: current.excerpt,
    newSlug: NEW_SLUG,
  });
  console.log(`Snapshot previo guardado: editId=${edit.editId}`);

  logger.info("fix-production-draft-1960: iniciando actualizacion real", { pageId: PAGE_ID, editId: edit.editId });

  try {
    const result = await updateProductionDraftPage({
      pageId: PAGE_ID,
      title: current.title,
      contentHtml: NEW_CONTENT_HTML,
      excerpt: current.excerpt,
      slug: NEW_SLUG,
    });

    console.log("");
    console.log("=== Correccion aplicada ===");
    console.log(`wordpressPageId: ${result.wordpressPageId}`);
    console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
    console.log(`editId (para rollback si hace falta): ${edit.editId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la correccion real: ${message}`);
    markProductionDraftEditFailed(edit.editId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
