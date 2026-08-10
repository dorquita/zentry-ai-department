import { setActionStatus, findActionById } from "../src/core/action-backlog";

/**
 * Fase O27.2 -- Pau decidio el caso cerraduras: DIFERENCIAR (no fusionar,
 * no redirigir todavia). /cerraduras-inteligentes-taquillas/ (1865) queda
 * como pagina informativa; /cerraduras-para-taquillas/ (2060, O22) sigue
 * como landing comercial, sin tocar. Las 5 acciones que O27 dejo en
 * waiting_approval (bloqueadas hasta esta decision) pasan a approved --
 * la decision estrategica ya esta tomada, ahora se ejecuta en staging
 * (change pack 6bba78a5, ver staging-executions.jsonl).
 *
 * Uso: npx ts-node scripts/o272-approve-cerraduras-decision.ts
 */

const IDS = [
  "19599263-9e05-4bca-8d6a-761cf54f3aad",
  "4bdbbe6e-743a-40df-822f-615935e57cfa",
  "ef7a3825-b95f-4942-a4dc-46faed0d825e",
  "1a0e540c-8785-482b-9be2-217c5d6fe818",
  "b764c03e-3b88-441f-aa88-117d45d97e21",
];

function main(): void {
  for (const id of IDS) {
    const existing = findActionById(id);
    if (!existing) {
      console.log(`[SKIP] ${id} no encontrada.`);
      continue;
    }
    const updated = setActionStatus(id, "approved", "o272-cerraduras-decision");
    console.log(`${id} "${existing.keyword}" ${existing.status} -> ${updated?.status}`);
  }
}

main();
