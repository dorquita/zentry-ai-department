import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DEFAULT_FIXTURE_PATH, loadArtifact, parseArgs } from "../scripts/run-qa-reviewer";
import { inferArtifactIdentity } from "../src/employees/qa-reviewer/context";

/**
 * Cubre el comportamiento de "preparacion" de scripts/run-qa-reviewer.ts
 * (paso 1 del runner) SIN invocarlo como subproceso CLI -- importa
 * directamente las funciones exportadas (ver el guard
 * `require.main === module` al final de ese fichero, que evita que un
 * simple `import` dispare la ejecucion completa del CLI). Cubre los dos
 * caminos pedidos: --artifact-path explicito, y fallback al fixture
 * embebido cuando no se pasa ninguno.
 */
export interface TestCase {
  name: string;
  fn: () => void;
}

export function runQaReviewerRunnerTests(): TestCase[] {
  return [
    // --- parseArgs: parseo minimo de argv, mismo patron que el runner de landing-architect ---
    {
      name: "parseArgs: --artifact-path <valor> se parsea como clave/valor",
      fn: () => {
        const args = parseArgs(["--artifact-path", "/tmp/foo.json"]);
        assert.equal(args["artifact-path"], "/tmp/foo.json");
      },
    },
    {
      name: "parseArgs: sin argumentos devuelve un objeto vacio",
      fn: () => {
        assert.deepEqual(parseArgs([]), {});
      },
    },

    // --- loadArtifact: caso SIN --artifact-path -- fallback al fixture embebido ---
    {
      name: "loadArtifact(undefined): cae al fixture embebido test/fixtures/qa-reviewer-example-artifact.json, marcado isFallbackFixture=true",
      fn: () => {
        const loaded = loadArtifact(undefined);
        assert.equal(loaded.isFallbackFixture, true);
        assert.equal(loaded.relativePath, path.join("test", "fixtures", "qa-reviewer-example-artifact.json"));
        assert.ok(fs.existsSync(DEFAULT_FIXTURE_PATH), "el fixture embebido debe existir de verdad en disco");
        const parsed = loaded.parsed as Record<string, unknown>;
        assert.equal(parsed.changePackId, "example-change-pack-001");
      },
    },
    {
      name: "loadArtifact(undefined): el contenido cargado, pasado por inferArtifactIdentity, produce la identidad esperada del fixture por defecto",
      fn: () => {
        const loaded = loadArtifact(undefined);
        const identity = inferArtifactIdentity(loaded.relativePath, loaded.parsed);
        assert.equal(identity.artifactType, "landing_architect_comparison");
        assert.equal(identity.sourceEmployee, "ux-ui-landing-architect-v2");
        assert.equal(identity.artifactId, "example-change-pack-001");
      },
    },

    // --- loadArtifact: caso CON --artifact-path explicito ---
    {
      name: "loadArtifact(<ruta explicita>): carga y parsea ese fichero, marcado isFallbackFixture=false",
      fn: () => {
        const loaded = loadArtifact(DEFAULT_FIXTURE_PATH);
        assert.equal(loaded.isFallbackFixture, false);
        const parsed = loaded.parsed as Record<string, unknown>;
        assert.equal(parsed.changePackId, "example-change-pack-001");
      },
    },
    {
      name: "loadArtifact(<ruta explicita a un JSON generico>): funciona igual para un artifact que no tiene la forma de landing-architect-comparison",
      fn: () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reviewer-test-"));
        const tmpFile = path.join(tmpDir, "generic-artifact.json");
        fs.writeFileSync(tmpFile, JSON.stringify({ hello: "world" }), "utf-8");
        try {
          const loaded = loadArtifact(tmpFile);
          assert.equal(loaded.isFallbackFixture, false);
          assert.deepEqual(loaded.parsed, { hello: "world" });
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },

    // --- loadArtifact: fail-closed ---
    {
      name: "loadArtifact(<ruta inexistente>): lanza con un mensaje explicito -- fail-closed, nunca cae en silencio al fixture",
      fn: () => {
        const missingPath = path.join(os.tmpdir(), "qa-reviewer-artifact-que-no-existe-" + Date.now() + ".json");
        assert.throws(() => loadArtifact(missingPath), /no existe/);
      },
    },
    {
      name: "loadArtifact(<fichero con JSON invalido>): lanza con un mensaje explicito -- fail-closed",
      fn: () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reviewer-test-"));
        const tmpFile = path.join(tmpDir, "broken.json");
        fs.writeFileSync(tmpFile, "{ esto no es JSON valido ", "utf-8");
        try {
          assert.throws(() => loadArtifact(tmpFile), /no es JSON valido/);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      },
    },
  ];
}
