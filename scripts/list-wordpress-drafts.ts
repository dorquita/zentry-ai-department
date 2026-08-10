/**
 * Lista WordPress drafts locales. Solo lectura.
 *
 * Uso:
 *   npm run wordpress-drafts:list
 *   npm run wordpress-drafts:list -- --status local_preview
 *   npm run wordpress-drafts:list -- --status wp_draft_created
 *   npm run wordpress-drafts:list -- --targetBrand zentry
 *   npm run wordpress-drafts:list -- --changePackId <id>
 */
import * as dotenv from "dotenv";
dotenv.config();

import { isValidWordpressDraftStatus, readCurrentWordpressDrafts } from "../src/core/wordpress-drafts";
import { WORDPRESS_DRAFT_STATUSES } from "../src/core/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let drafts = readCurrentWordpressDrafts();
  const totalBeforeFilter = drafts.length;

  if (args.status) {
    if (!isValidWordpressDraftStatus(args.status)) {
      console.error(`--status invalido: "${args.status}". Validos: ${WORDPRESS_DRAFT_STATUSES.join(", ")}.`);
      process.exit(1);
    }
    drafts = drafts.filter((d) => d.status === args.status);
  }

  if (args.targetBrand) {
    drafts = drafts.filter((d) => d.targetBrand === args.targetBrand);
  }

  if (args.changePackId) {
    drafts = drafts.filter((d) => d.changePackId === args.changePackId);
  }

  if (args.keyword) {
    const needle = args.keyword.toLowerCase();
    drafts = drafts.filter((d) => d.keyword.toLowerCase().includes(needle));
  }

  drafts = drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const limit = args.limit ? Number(args.limit) : undefined;
  const shown = limit ? drafts.slice(0, limit) : drafts;

  console.log(`${shown.length} de ${drafts.length} draft(s) filtrado(s) (total: ${totalBeforeFilter}).`);
  console.log("");

  for (const d of shown) {
    console.log(`[${d.status}] ${d.draftId}`);
    console.log(`  keyword="${d.keyword}" page="${d.page ?? ""}" targetBrand=${d.targetBrand} draftType=${d.draftType}`);
    console.log(`  changePackId=${d.changePackId} workOrderId=${d.workOrderId}`);
    console.log(`  localPreviewPath=${d.localPreviewPath}`);
    if (d.wordpressDraftId) {
      console.log(`  wordpressDraftId=${d.wordpressDraftId} wordpressDraftUrl=${d.wordpressDraftUrl}`);
    }
    console.log(`  updatedAt=${d.updatedAt.slice(0, 10)}`);
    console.log("");
  }
}

main();
