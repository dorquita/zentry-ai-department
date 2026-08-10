/**
 * Ejecuta la suite de validacion contra el dataset REAL del backlog
 * (data/action-backlog.jsonl, data/work-orders.jsonl,
 * data/approval-requests.jsonl) — solo lectura, no modifica nada. A
 * diferencia de `npm test` (puro/sintetico, funciona en cualquier
 * sitio), esto necesita datos reales generados por al menos una pasada
 * de `npm run growth:daily`.
 *
 * Uso: npm run test:real-data
 */
import * as dotenv from "dotenv";
dotenv.config();

import { runRealDataTests } from "../test/executive-report.real-data.test";

interface TestCase {
  name: string;
  fn: () => void;
}

function main(): void {
  console.log("\nexecutive-report (dataset real)");
  const cases: TestCase[] = runRealDataTests();

  let passed = 0;
  let failed = 0;
  for (const testCase of cases) {
    try {
      testCase.fn();
      passed += 1;
      console.log(`  ok - ${testCase.name}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL - ${testCase.name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
