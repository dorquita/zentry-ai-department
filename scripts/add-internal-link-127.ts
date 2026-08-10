import * as readline from "readline";
import * as dotenv from "dotenv";
dotenv.config();
import { getProductionPage, getProductionStatusForReport, updateProductionPublishedPageContent } from "../src/adapters/wordpress-production";
import { recordPendingProductionDraftEdit, markProductionDraftEditFailed } from "../src/core/production-draft-edits";
import { logger } from "../src/core/logger";

/**
 * Fase O13.8: anade un enlace interno natural desde la pagina PUBLICADA
 * /taquillas-para-colegios/ (id 127) hacia /taquillas-escolares/ (id
 * 1960, corregida en O13.7b). Usa la misma
 * updateProductionPublishedPageContent() de O13.7b (rechaza cualquier
 * pagina que no este ya "publish", nunca toca status ni slug). Modifica
 * un unico parrafo existente (el que ya enlazaba a "taquillas por
 * sector", un parrafo de enlaces relacionados) para anadir el nuevo
 * enlace en el mismo estilo -- nunca un enlace suelto al final de la
 * pagina. El resto del contenido (CTA/formulario/FAQ/precio) queda
 * caracter por caracter identico.
 */

const PAGE_ID = 127;
const OLD_PARAGRAPH =
  '<p>También puedes consultar otras soluciones por sector en nuestra página de <a href="https://zentrylockers.com/taquillas-por-sector/">taquillas por sector</a>.</p>';
const NEW_PARAGRAPH =
  '<p>También puedes consultar otras soluciones por sector en nuestra página de <a href="https://zentrylockers.com/taquillas-por-sector/">taquillas por sector</a>, o ver nuestra página de <a href="https://zentrylockers.com/taquillas-escolares/">taquillas escolares para centros educativos</a> con más detalle sobre materiales y presupuesto.</p>';

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
  console.log(`PRODUCTION_EXECUTION_ENABLED=${prodStatus.executionEnabled} PRODUCTION_DRAFTS_ENABLED=${prodStatus.draftsEnabled} PRODUCTION_BACKEND=${prodStatus.backend}`);

  const current = await getProductionPage(PAGE_ID);
  console.log(`Estado actual: status="${current.status}" title="${current.title}" slug="${current.slug}"`);
  if (current.status !== "publish") {
    console.error(`La pagina ${PAGE_ID} no esta en status "publish" (esta en "${current.status}"). Bloqueado.`);
    process.exit(1);
    return;
  }

  const occurrences = current.contentHtml.split(OLD_PARAGRAPH).length - 1;
  if (occurrences !== 1) {
    console.error(`El parrafo esperado aparece ${occurrences} veces (se esperaba exactamente 1). Contenido de la pagina puede haber cambiado desde la ultima lectura -- abortando sin tocar nada.`);
    process.exit(1);
    return;
  }
  const newContentHtml = current.contentHtml.replace(OLD_PARAGRAPH, NEW_PARAGRAPH);

  console.log("");
  console.log("=== Cambio propuesto (unico parrafo modificado) ===");
  console.log(`ANTES: ${OLD_PARAGRAPH}`);
  console.log(`DESPUES: ${NEW_PARAGRAPH}`);

  if (!prodStatus.canWrite) {
    console.log("");
    console.log("SIMULACION (no se toca la red): faltan condiciones. Cambio listo para cuando se activen los flags.");
    return;
  }

  const answer = await plainPrompt(
    `\nVas a anadir un enlace interno en la pagina PUBLICADA ${PAGE_ID} (/taquillas-para-colegios/) hacia /taquillas-escolares/. El status seguira "publish", el slug no cambia, ningun otro contenido se toca. Escribe "si" para confirmar: `
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
    newContentHtml,
    newExcerpt: current.excerpt,
    newSlug: current.slug,
  });
  console.log(`Snapshot previo guardado: editId=${edit.editId}`);

  logger.info("add-internal-link-127: iniciando insercion de enlace interno (pagina ya publicada)", { pageId: PAGE_ID, editId: edit.editId });

  try {
    const result = await updateProductionPublishedPageContent({
      pageId: PAGE_ID,
      title: current.title,
      contentHtml: newContentHtml,
      excerpt: current.excerpt,
    });

    console.log("");
    console.log("=== Enlace anadido ===");
    console.log(`wordpressPageId: ${result.wordpressPageId}`);
    console.log(`wordpressDraftUrl: ${result.wordpressDraftUrl}`);
    console.log(`editId (para rollback si hace falta): ${edit.editId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fallo la insercion del enlace: ${message}`);
    markProductionDraftEditFailed(edit.editId, message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
