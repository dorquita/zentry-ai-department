import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  STATE_PATHS,
  StateManifest,
  captureStateManifest,
  detectStateRegressions,
  renderStateVerification,
  summarizeStateGrowth,
} from "../src/core/state-persistence";

/**
 * Fase O55 — tests de la persistencia de estado.
 *
 * Lo que se fija aqui es la invariante de la que depende TODO el diseno:
 * los `.jsonl` del departamento son append-only, asi que perder lineas
 * es imposible en una pasada sana y debe tratarse como fallo, no como
 * algo a tolerar.
 */

export interface TestCase {
  name: string;
  fn: () => void;
}

const REPO_ROOT = path.join(__dirname, "..");

/** Crea un arbol de estado temporal y lo limpia siempre. */
function withTempState(
  files: Record<string, string>,
  fn: (baseDir: string) => void
): void {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "zentry-state-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(baseDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    }
    fn(baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

function jsonl(...lines: string[]): string {
  return lines.map((l) => JSON.stringify({ v: l })).join("\n") + "\n";
}

export function runStatePersistenceTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // La invariante: los .jsonl de estado son append-only
    // ---------------------------------------------------------------
    {
      name: "INVARIANTE: ningun modulo que escribe estado reescribe un .jsonl, todos hacen append",
      fn: () => {
        // Si alguien introdujera un writeFileSync sobre un .jsonl de
        // estado, toda la deteccion de perdida de datos de este modulo
        // dejaria de tener sentido. Se comprueba sobre el codigo real.
        const stateModules = [
          "action-backlog",
          "change-packs",
          "work-orders",
          "approval-requests",
          "opportunity-state-log",
          "job-registry",
          "department-events",
          "credential-health",
        ];
        for (const moduleName of stateModules) {
          const source = fs.readFileSync(path.join(REPO_ROOT, "src", "core", `${moduleName}.ts`), "utf-8");
          assert.ok(source.includes("appendFileSync"), `${moduleName}.ts deberia escribir con appendFileSync`);
          assert.equal(
            source.includes("writeFileSync"),
            false,
            `${moduleName}.ts NO puede reescribir su fichero: rompería la invariante append-only en la que se apoya la persistencia`
          );
        }
      },
    },

    // ---------------------------------------------------------------
    // Captura del manifiesto
    // ---------------------------------------------------------------
    {
      name: "el manifiesto cuenta lineas solo en los .jsonl, e ignora las lineas en blanco",
      fn: () => {
        withTempState(
          {
            "data/jobs.jsonl": jsonl("a", "b") + "\n   \n",
            "reports/daily/executive-2026-08-16.md": "# Informe\n",
          },
          (baseDir) => {
            const manifest = captureStateManifest(baseDir, "2026-08-16T15:00:00.000Z");
            const jobs = manifest.files.find((f) => f.path === "data/jobs.jsonl");
            const report = manifest.files.find((f) => f.path === "reports/daily/executive-2026-08-16.md");
            assert.equal(jobs?.lines, 2, "las lineas en blanco no cuentan como estado");
            assert.equal(report?.lines, null, "un .md no tiene lineas de estado que contar");
            assert.ok((report?.bytes ?? 0) > 0);
          }
        );
      },
    },
    {
      name: "el manifiesto cubre exactamente las rutas declaradas y nada mas",
      fn: () => {
        withTempState(
          {
            "data/jobs.jsonl": jsonl("a"),
            "reports/seo/informe.md": "x",
            "src/no-es-estado.ts": "no deberia aparecer",
          },
          (baseDir) => {
            const manifest = captureStateManifest(baseDir, "2026-08-16T15:00:00.000Z");
            const paths = manifest.files.map((f) => f.path);
            assert.deepEqual(paths.sort(), ["data/jobs.jsonl", "reports/seo/informe.md"]);
            assert.deepEqual([...STATE_PATHS], ["data", "reports"]);
          }
        );
      },
    },
    {
      name: "un directorio de estado ausente no rompe la captura",
      fn: () => {
        withTempState({ "data/jobs.jsonl": jsonl("a") }, (baseDir) => {
          const manifest = captureStateManifest(baseDir, "2026-08-16T15:00:00.000Z");
          assert.equal(manifest.files.length, 1);
        });
      },
    },

    // ---------------------------------------------------------------
    // Deteccion de perdida de datos
    // ---------------------------------------------------------------
    {
      name: "crecer NO es una regresion: una pasada sana anade lineas y ficheros",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "data/jobs.jsonl", lines: 10, bytes: 100 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [
            { path: "data/jobs.jsonl", lines: 14, bytes: 140 },
            { path: "reports/daily/executive-2026-08-16.md", lines: null, bytes: 500 },
          ],
        };
        assert.deepEqual(detectStateRegressions(before, after), []);
        assert.deepEqual(summarizeStateGrowth(before, after), {
          newFiles: 1,
          filesWithNewLines: 1,
          newLines: 4,
        });
      },
    },
    {
      name: "perder lineas de un .jsonl es una regresion y se explica por que es imposible en una pasada sana",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "data/action-backlog.jsonl", lines: 5000, bytes: 20_000_000 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "data/action-backlog.jsonl", lines: 12, bytes: 4_000 }],
        };
        const regressions = detectStateRegressions(before, after);
        assert.equal(regressions.length, 1);
        assert.equal(regressions[0].kind, "lines_lost");
        assert.match(regressions[0].detail, /append-only/);
      },
    },
    {
      name: "que un fichero de estado desaparezca es una regresion",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "data/approval-requests.jsonl", lines: 40, bytes: 900 }],
        };
        const after: StateManifest = { capturedAt: "t1", files: [] };
        const regressions = detectStateRegressions(before, after);
        assert.equal(regressions.length, 1);
        assert.equal(regressions[0].kind, "file_disappeared");
      },
    },
    {
      name: "un fichero que no es .jsonl y encoge tambien se detecta (truncado)",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "reports/daily/technical-2026-08-16.md", lines: null, bytes: 50_000 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "reports/daily/technical-2026-08-16.md", lines: null, bytes: 12 }],
        };
        const regressions = detectStateRegressions(before, after);
        assert.equal(regressions.length, 1);
        assert.equal(regressions[0].kind, "bytes_lost");
      },
    },
    {
      name: "un informe del dia que se regenera con el MISMO o MAS contenido no es una regresion",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "reports/daily/executive-2026-08-16.md", lines: null, bytes: 5_000 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "reports/daily/executive-2026-08-16.md", lines: null, bytes: 5_400 }],
        };
        assert.deepEqual(detectStateRegressions(before, after), []);
      },
    },
    {
      name: "varias regresiones a la vez se reportan TODAS, no solo la primera",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [
            { path: "data/jobs.jsonl", lines: 100, bytes: 1000 },
            { path: "data/change-packs.jsonl", lines: 50, bytes: 500 },
            { path: "data/work-orders.jsonl", lines: 20, bytes: 200 },
          ],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "data/jobs.jsonl", lines: 90, bytes: 900 }],
        };
        const regressions = detectStateRegressions(before, after);
        assert.equal(regressions.length, 3);
        assert.deepEqual(regressions.map((r) => r.kind).sort(), [
          "file_disappeared",
          "file_disappeared",
          "lines_lost",
        ]);
      },
    },

    // ---------------------------------------------------------------
    // Informe
    // ---------------------------------------------------------------
    {
      name: "el informe dice explicitamente que NO se persiste nada cuando hay regresiones",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "data/jobs.jsonl", lines: 100, bytes: 1000 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "data/jobs.jsonl", lines: 3, bytes: 30 }],
        };
        const markdown = renderStateVerification(before, after, detectStateRegressions(before, after));
        assert.match(markdown, /no se persiste nada/i);
        assert.match(markdown, /data\/jobs\.jsonl/);
      },
    },
    {
      name: "el informe de una pasada sana cuantifica cuanto ha avanzado el estado",
      fn: () => {
        const before: StateManifest = {
          capturedAt: "t0",
          files: [{ path: "data/jobs.jsonl", lines: 100, bytes: 1000 }],
        };
        const after: StateManifest = {
          capturedAt: "t1",
          files: [{ path: "data/jobs.jsonl", lines: 131, bytes: 1310 }],
        };
        const markdown = renderStateVerification(before, after, []);
        assert.match(markdown, /Sin regresiones/);
        assert.match(markdown, /Lineas de estado nuevas:\*\* 31/);
      },
    },

    // ---------------------------------------------------------------
    // Cableado del workflow
    // ---------------------------------------------------------------
    {
      name: "solo el job de persistencia tiene contents: write; el que ejecuta Claude sigue en read",
      fn: () => {
        const daily = fs.readFileSync(
          path.join(REPO_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml"),
          "utf-8"
        );
        // Permiso global del workflow.
        assert.match(daily, /^permissions:\n  contents: read$/m);
        // El unico contents: write esta dentro del job persist-state.
        const persistJob = daily.slice(daily.indexOf("  persist-state:"));
        assert.match(persistJob, /permissions:\s*\n\s*contents: write/);
        // Se quitan los comentarios YAML: el bloque que documenta el job
        // de persistencia explica por que EL necesita `contents: write`,
        // y esa frase no puede hacer fallar el test que comprueba que
        // nadie mas lo tiene. Lo que se busca es una ASIGNACION real.
        const beforePersist = daily
          .slice(0, daily.indexOf("  persist-state:"))
          .split("\n")
          .filter((line) => !line.trim().startsWith("#"))
          .join("\n");
        assert.equal(
          /^\s*contents:\s*write\s*$/m.test(beforePersist),
          false,
          "el job que ejecuta a los empleados Claude NUNCA puede tener permiso de escritura"
        );
      },
    },
    {
      name: "la pasada restaura el estado antes de empezar y lo verifica antes de persistirlo",
      fn: () => {
        const daily = fs.readFileSync(
          path.join(REPO_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml"),
          "utf-8"
        );
        const restoreIndex = daily.indexOf("[STATE] Restaurar data/ y reports/");
        const snapshotIndex = daily.indexOf("npm run state:snapshot");
        const verifyIndex = daily.indexOf("npm run state:verify");
        const uploadIndex = daily.indexOf("department-state-${{ github.run_id }}");
        assert.ok(restoreIndex > 0 && snapshotIndex > restoreIndex, "el manifiesto se toma DESPUES de restaurar");
        assert.ok(verifyIndex > snapshotIndex, "se verifica despues de la pasada");
        assert.ok(uploadIndex > verifyIndex, "solo se empaqueta el estado si la verificacion paso");
      },
    },
    {
      name: "el job de persistencia no corre si la pasada fallo (sin if: always)",
      fn: () => {
        const daily = fs.readFileSync(
          path.join(REPO_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml"),
          "utf-8"
        );
        const persistJob = daily.slice(daily.indexOf("  persist-state:"));
        assert.match(persistJob, /needs: department-run/);
        // Un `if: always()` a nivel de job persistiria estado de una
        // pasada rota: la rama debe conservar el ultimo estado bueno.
        const jobHeader = persistJob.slice(0, persistJob.indexOf("steps:"));
        assert.equal(jobHeader.includes("always()"), false);
      },
    },
    {
      name: "el push usa --force-with-lease, nunca --force a secas",
      fn: () => {
        const daily = fs.readFileSync(
          path.join(REPO_ROOT, ".github", "workflows", "zentry-ai-department-daily.yml"),
          "utf-8"
        );
        assert.match(daily, /git push --force-with-lease origin "HEAD:\$STATE_BRANCH"/);
        assert.equal(/git push --force /.test(daily), false, "--force a secas pisaria el trabajo de otro escritor");
      },
    },
  ];
}
