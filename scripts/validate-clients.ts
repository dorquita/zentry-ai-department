/**
 * Fase O16 — valida el ClientConfig de uno o todos los clientes: schema,
 * URLs, catalogo de servicios, ficheros referenciados existentes, y
 * ausencia de secretos literales en el JSON. Solo lectura, exit code
 * distinto de 0 si hay algun problema (pensado para poder engancharse a
 * CI en el futuro).
 *
 * Uso:
 *   npm run clients:validate
 *   npm run clients:validate -- --client zentry
 */
import { listClientIds, loadClientConfig, validateClientConfig } from "../src/core/client-config";

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
  const targetClientIds = args.client ? [args.client] : listClientIds();

  if (targetClientIds.length === 0) {
    console.error("No hay ningun cliente que validar (clients/ vacio o inexistente).");
    process.exit(1);
  }

  let totalIssues = 0;
  for (const clientId of targetClientIds) {
    console.log(`\n=== ${clientId} ===`);
    try {
      const config = loadClientConfig(clientId, { strict: true });
      const issues = validateClientConfig(config);
      if (issues.length === 0) {
        console.log("  OK — sin problemas.");
      } else {
        totalIssues += issues.length;
        for (const issue of issues) {
          console.log(`  FALLO [${issue.field}]: ${issue.message}`);
        }
      }
    } catch (err) {
      totalIssues += 1;
      console.log(`  FALLO al cargar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${targetClientIds.length} cliente(s) revisado(s), ${totalIssues} problema(s) encontrado(s).`);
  process.exit(totalIssues > 0 ? 1 : 0);
}

main();
