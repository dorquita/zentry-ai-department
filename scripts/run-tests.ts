/**
 * Runner de tests minimo, sin dependencias nuevas (usa node:assert, ya
 * incluido en Node). Cada suite exporta una lista de { name, fn } — si
 * `fn()` lanza, el test falla. Pensado para pruebas puras de logica de
 * negocio (deduplicacion, redaccion de informes), no para tests de
 * integracion contra el VPS real.
 *
 * Uso: npm test
 */
import { runExecutiveReportTests } from "../test/executive-report.test";
import { runNovamiraGuardTests } from "../test/novamira-guard.test";
import { runClientConfigTests } from "../test/client-config.test";

interface TestCase {
  name: string;
  fn: () => void;
}

function main(): void {
  const suites: Array<{ suiteName: string; cases: TestCase[] }> = [
    { suiteName: "executive-report", cases: runExecutiveReportTests() },
    { suiteName: "novamira-guard", cases: runNovamiraGuardTests() },
    { suiteName: "client-config", cases: runClientConfigTests() },
  ];

  let passed = 0;
  let failed = 0;

  for (const suite of suites) {
    console.log(`\n${suite.suiteName}`);
    for (const testCase of suite.cases) {
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
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
