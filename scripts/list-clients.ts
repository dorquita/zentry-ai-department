/**
 * Fase O16 — lista los clientes conocidos por la plataforma (carpetas
 * bajo clients/ con un client.config.json valido). Solo lectura, nunca
 * imprime secretos (el esquema de ClientConfig no los contiene: los
 * secretos siguen solo en .env).
 *
 * Uso:
 *   npm run clients:list
 */
import { listClientIds, loadClientConfig, DEFAULT_CLIENT_ID } from "../src/core/client-config";

function main(): void {
  const clientIds = listClientIds();
  if (clientIds.length === 0) {
    console.log("No hay clientes en clients/ (o la carpeta no existe).");
    return;
  }

  console.log(`Clientes encontrados: ${clientIds.length}\n`);
  for (const clientId of clientIds) {
    try {
      const config = loadClientConfig(clientId, { strict: true });
      const marker = clientId === DEFAULT_CLIENT_ID ? " (por defecto)" : "";
      console.log(`- ${config.clientId}${marker}`);
      console.log(`    nombre: ${config.clientName}`);
      console.log(`    marca: ${config.brandName}${config.secondaryBrands.length ? ` (+ ${config.secondaryBrands.join(", ")})` : ""}`);
      console.log(`    produccion: ${config.productionUrl}`);
      console.log(`    staging: ${config.stagingUrl ?? "(no definido)"}`);
      console.log(`    sandbox: ${config.isSandbox}`);
      console.log(`    servicios permitidos: ${config.allowedServices.length}`);
      console.log(`    estado de cableado: ${config.wiringStatus}`);
      console.log("");
    } catch (err) {
      console.log(`- ${clientId} -> ERROR al cargar: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

main();
