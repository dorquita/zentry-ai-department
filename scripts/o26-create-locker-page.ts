import * as dotenv from "dotenv";
dotenv.config();
import { createWordpressDraftPage, publishStagingDraftPage, getWordpressPage } from "../src/adapters/wordpress";

/**
 * Fase O26 -- crea la pagina de staging /configurador-taquillas/ para el
 * MVP del configurador de taquillas, mismo patron que la pagina 2077
 * (/configurador-bancos/, O23.2): contenido minimo (1 parrafo + shortcode),
 * creada como "draft" (createWordpressDraftPage nunca publica directamente,
 * guardrail incondicional del adapter) y publicada aparte en un segundo
 * paso explicito -- publicada para permitir QA real con navegador, pero
 * NUNCA enlazada en ningun menu (igual que /configurador-bancos/).
 *
 * Uso:
 *   WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o26-create-locker-page.ts --confirm
 */

async function main(): Promise<void> {
  const confirm = process.argv.includes( "--confirm" );
  if ( !confirm ) {
    console.log( "Dry-run: este script solo crea contenido real (nunca produccion, nunca WooCommerce). Repite con --confirm (+ flags inline) para crear la pagina de verdad." );
    console.log( 'Titulo: "Configurador de taquillas (prototipo)", slug: "configurador-taquillas"' );
    console.log( 'Contenido: <p>Prototipo interno O26 -- no enlazado en menu.</p>\\n\\n[zentry_locker_configurator product="taquillas"]' );
    return;
  }

  const draft = await createWordpressDraftPage( {
    title: "Configurador de taquillas (prototipo)",
    slug: "configurador-taquillas",
    contentHtml: '<p>Prototipo interno O26 -- no enlazado en menu.</p>\n\n[zentry_locker_configurator product="taquillas"]',
  } );
  console.log( "Borrador creado:", JSON.stringify( draft ) );

  const published = await publishStagingDraftPage( draft.wordpressDraftId );
  console.log( "Publicada:", JSON.stringify( published ) );

  const verify = await getWordpressPage( draft.wordpressDraftId );
  console.log( "Verificacion -- status:", verify.status, "| link:", verify.link );
  console.log( "\n=== Rollback ===" );
  console.log( `unpublishStagingPage(${draft.wordpressDraftId}) para volver a borrador (no enlazada en ningun menu de todos modos).` );
}

main().catch( ( err ) => {
  console.error( "Error inesperado:", err instanceof Error ? err.message : err );
  process.exit( 1 );
} );
