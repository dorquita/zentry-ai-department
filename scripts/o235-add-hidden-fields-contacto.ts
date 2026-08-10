import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
import { getWordpressPage, updateStagingPublishedPageContent } from "../src/adapters/wordpress";

/**
 * Ajuste "email en staging" -- anade 4 campos ocultos al formulario Kadence
 * REAL de /contacto/ (pagina id 30) para poder llevar la configuracion del
 * configurador 3D (material/longitud/configuracion/URL) hasta el email que
 * genera ese formulario. Edicion QUIRURGICA: solo se anaden 4 objetos al
 * final del array `fields` del bloque `wp:kadence/form`, y 4 `<input
 * type="hidden">` correspondientes en el HTML renderizado, justo antes de
 * los campos internos de Kadence (`_kb_form_id` etc.). NADA MAS del bloque
 * (style/submit/email/redirect/actions/containerMargin) ni de las 8
 * preguntas existentes se toca.
 *
 * Uso:
 *   npx ts-node scripts/o235-add-hidden-fields-contacto.ts                      (dry-run: imprime el HTML nuevo, no escribe nada)
 *   WORDPRESS_DRAFTS_ENABLED=true WORDPRESS_BACKEND=rest npx ts-node scripts/o235-add-hidden-fields-contacto.ts --confirm
 */

const PAGE_ID = 30;

const NEW_FIELDS = [
  { label: "Material configurador", dataType: "material" },
  { label: "Longitud configurador", dataType: "longitud" },
  { label: "Configuración configurador", dataType: "configuracion" },
  { label: "URL configuración", dataType: "config-url" },
];

function buildFieldJson( label: string ): string {
  return JSON.stringify( {
    label,
    showLabel: false,
    placeholder: "",
    default: "",
    rows: 4,
    options: [],
    multiSelect: false,
    inline: false,
    showLink: false,
    min: "",
    max: "",
    type: "hidden",
    required: false,
    width: [ "100", "", "" ],
    auto: "",
    errorMessage: "",
    requiredMessage: "",
    description: "",
  } );
}

function esc( value: string ): string {
  return value.replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ).replace( /"/g, "&quot;" );
}

async function main(): Promise<void> {
  const confirm = process.argv.includes( "--confirm" );

  const page = await getWordpressPage( PAGE_ID );
  if ( page.status !== "publish" ) {
    throw new Error( `La pagina ${PAGE_ID} no esta en status "publish" (esta en "${page.status}"). Bloqueado.` );
  }
  const raw = page.contentHtml;

  // 1) Localizar el comentario de bloque wp:kadence/form y su JSON de atributos.
  const commentStart = "<!-- wp:kadence/form ";
  const commentIdx = raw.indexOf( commentStart );
  if ( commentIdx === -1 ) throw new Error( "No se encontro el bloque wp:kadence/form en la pagina. Bloqueado -- no se toca nada." );
  const jsonStart = commentIdx + commentStart.length;
  const jsonEnd = raw.indexOf( " -->", jsonStart );
  const attrsJsonRaw = raw.slice( jsonStart, jsonEnd );
  const attrs = JSON.parse( attrsJsonRaw );

  if ( !Array.isArray( attrs.fields ) ) throw new Error( "El bloque no tiene un array 'fields' valido. Bloqueado." );
  const existingFieldCount = attrs.fields.length;
  const existingLabels = attrs.fields.map( ( f: { label: string } ) => f.label );
  for ( const nf of NEW_FIELDS ) {
    if ( existingLabels.includes( nf.label ) ) {
      throw new Error( `Ya existe un campo con la etiqueta "${nf.label}" -- bloqueado para no duplicar (¿ya se ejecuto este script antes?).` );
    }
  }

  const newFieldObjs = NEW_FIELDS.map( ( nf ) =>
    JSON.parse( buildFieldJson( nf.label ) )
  );
  attrs.fields = [ ...attrs.fields, ...newFieldObjs ];
  const newAttrsJson = JSON.stringify( attrs );

  const newComment = commentStart + newAttrsJson + " -->";
  const oldComment = raw.slice( commentIdx, jsonEnd + 4 );

  // 2) Localizar el HTML renderizado y anadir 4 <input type="hidden"> justo
  // antes del primer campo de sistema interno de Kadence (_kb_form_id).
  const systemHiddenMarker = '<input type="hidden" name="_kb_form_id"';
  const systemHiddenIdx = raw.indexOf( systemHiddenMarker );
  if ( systemHiddenIdx === -1 ) throw new Error( "No se encontro el marcador _kb_form_id en el HTML renderizado. Bloqueado." );

  const newInputsHtml = NEW_FIELDS.map( ( nf, i ) => {
    const index = existingFieldCount + i;
    return `<input type="hidden" name="kb_field_${index}" value="" data-label="${esc( nf.label )}" data-type="hidden" class="kb-field kb-hidden-field kb-field-${index}"/>`;
  } ).join( "" );

  let newRaw = raw.slice( 0, commentIdx ) + newComment + raw.slice( jsonEnd + 4 );
  // Recalcular systemHiddenIdx sobre newRaw (el comentario cambio de longitud).
  const systemHiddenIdxInNew = newRaw.indexOf( systemHiddenMarker );
  newRaw = newRaw.slice( 0, systemHiddenIdxInNew ) + newInputsHtml + newRaw.slice( systemHiddenIdxInNew );

  console.log( "=== Campos nuevos anadidos (indices " + existingFieldCount + "-" + ( existingFieldCount + NEW_FIELDS.length - 1 ) + ") ===" );
  NEW_FIELDS.forEach( ( nf, i ) => console.log( `  kb_field_${existingFieldCount + i} -> "${nf.label}"` ) );
  console.log( `\nLongitud contenido: ${raw.length} -> ${newRaw.length} caracteres` );

  const backupPath = `data/o235-contacto-precambio-${Date.now()}.json`;
  fs.writeFileSync( backupPath, JSON.stringify( { pageId: PAGE_ID, before: raw, after: newRaw }, null, 2 ) );
  console.log( `Snapshot antes/despues escrito: ${backupPath}` );

  if ( !confirm ) {
    console.log( "\n=== DRY-RUN: HTML nuevo alrededor del cambio (primeros 400 caracteres desde el primer input nuevo) ===" );
    const previewIdx = newRaw.indexOf( 'kb_field_' + existingFieldCount );
    console.log( newRaw.slice( Math.max( 0, previewIdx - 50 ), previewIdx + 500 ) );
    console.log( "\nRepite con --confirm (+ flags inline) para escribir de verdad." );
    return;
  }

  const result = await updateStagingPublishedPageContent( {
    pageId: PAGE_ID,
    title: page.title,
    contentHtml: newRaw,
  } );
  console.log( "\n=== ACTUALIZADO ===" );
  console.log( JSON.stringify( result ) );

  const verify = await getWordpressPage( PAGE_ID );
  const stillHasAll8 = existingLabels.every( ( l: string ) => verify.contentHtml.includes( `>${l}<` ) || verify.contentHtml.includes( `data-label="${l}"` ) );
  console.log( "Campos originales siguen presentes:", stillHasAll8 );
  console.log( "Campos nuevos presentes:", NEW_FIELDS.every( ( nf ) => verify.contentHtml.includes( `data-label="${nf.label}"` ) ) );

  console.log( "\n=== Rollback ===" );
  console.log( `Restaurar contentHtml desde el snapshot ${backupPath} (campo "before") via updateStagingPublishedPageContent().` );
}

main().catch( ( err ) => {
  console.error( "Error inesperado:", err instanceof Error ? err.message : err );
  process.exit( 1 );
} );
