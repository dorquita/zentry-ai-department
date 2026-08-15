import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { buildQaReviewerContext, inferArtifactIdentity } from "../src/employees/qa-reviewer/context";

export interface TestCase {
  name: string;
  fn: () => void;
}

export function runQaReviewerContextTests(): TestCase[] {
  return [
    // --- inferArtifactIdentity: reconoce la forma real de LandingArchitectComparisonArtifact ---
    {
      name: "inferArtifactIdentity reconoce el fixture real de landing-architect-comparison como landing_architect_comparison/ux-ui-landing-architect-v2",
      fn: () => {
        const fixturePath = path.join(__dirname, "fixtures", "qa-reviewer-example-artifact.json");
        const parsed = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as unknown;
        const identity = inferArtifactIdentity("test/fixtures/qa-reviewer-example-artifact.json", parsed);

        assert.equal(identity.artifactType, "landing_architect_comparison");
        assert.equal(identity.sourceEmployee, "ux-ui-landing-architect-v2");
        assert.equal(identity.artifactId, "example-change-pack-001");
        assert.equal(identity.artifactPath, "test/fixtures/qa-reviewer-example-artifact.json");
      },
    },
    {
      name: "inferArtifactIdentity: un JSON generico sin la forma de LandingArchitectComparisonArtifact cae a generic_json_artifact/unknown, sin lanzar",
      fn: () => {
        const parsed = { foo: "bar", nested: { baz: 1 } };
        const identity = inferArtifactIdentity("some/other/artifact.json", parsed);

        assert.equal(identity.artifactType, "generic_json_artifact");
        assert.equal(identity.sourceEmployee, "unknown");
        // Sin changePackId disponible, cae al nombre de fichero sin extension.
        assert.equal(identity.artifactId, "artifact");
        assert.equal(identity.artifactPath, "some/other/artifact.json");
      },
    },
    {
      name: "inferArtifactIdentity: un array top-level (no objeto) tambien cae a generic_json_artifact sin lanzar",
      fn: () => {
        const identity = inferArtifactIdentity("array-artifact.json", [1, 2, 3]);
        assert.equal(identity.artifactType, "generic_json_artifact");
        assert.equal(identity.sourceEmployee, "unknown");
        assert.equal(identity.artifactId, "array-artifact");
      },
    },
    {
      name: "inferArtifactIdentity: null/undefined tambien caen a generic_json_artifact sin lanzar",
      fn: () => {
        assert.doesNotThrow(() => inferArtifactIdentity("null-artifact.json", null));
        assert.doesNotThrow(() => inferArtifactIdentity("undef-artifact.json", undefined));
      },
    },
    {
      name: "inferArtifactIdentity: un objeto con changePackId pero SIN v1/v2/structuralDiff no se clasifica como landing_architect_comparison (forma incompleta)",
      fn: () => {
        const identity = inferArtifactIdentity("partial.json", { changePackId: "cp-1" });
        assert.equal(identity.artifactType, "generic_json_artifact");
        assert.equal(identity.sourceEmployee, "unknown");
        // changePackId SI se usa como artifactId aunque la forma completa no coincida -- es un dato del propio artifact, no depende de la deteccion de tipo.
        assert.equal(identity.artifactId, "cp-1");
      },
    },

    // --- buildQaReviewerContext: empaqueta identidad + contenido tal cual, sin transformarlo ---
    {
      name: "buildQaReviewerContext empaqueta identidad + artifact tal cual (sin mutar ninguno de los dos)",
      fn: () => {
        const identity = { sourceEmployee: "unknown", artifactType: "generic_json_artifact", artifactId: "x", artifactPath: "x.json" };
        const artifact = { some: "content" };
        const context = buildQaReviewerContext(identity, artifact);
        assert.deepEqual(context.identity, identity);
        assert.deepEqual(context.artifact, artifact);
        assert.equal(context.artifact, artifact, "debe ser la MISMA referencia, no una copia -- este builder no transforma el contenido");
      },
    },
  ];
}
