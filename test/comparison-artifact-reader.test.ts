import * as assert from "node:assert/strict";
import { extractFabricationWarnings } from "../src/core/comparison-artifact-reader";

export interface TestCase {
  name: string;
  fn: () => void;
}

export function runComparisonArtifactReaderTests(): TestCase[] {
  return [
    {
      name: "extractFabricationWarnings devuelve los warnings tal cual cuando v2.status es executed",
      fn: () => {
        const artifact = { v2: { status: "executed", fabricationWarnings: ["warning 1", "warning 2"] } };
        assert.deepEqual(extractFabricationWarnings(artifact), ["warning 1", "warning 2"]);
      },
    },
    {
      name: "extractFabricationWarnings devuelve [] cuando fabricationWarnings esta vacio (no debe romper nada)",
      fn: () => {
        const artifact = { v2: { status: "executed", fabricationWarnings: [] } };
        assert.deepEqual(extractFabricationWarnings(artifact), []);
      },
    },
    {
      name: "extractFabricationWarnings devuelve [] cuando v2.status es pending_execution (no existe fabricationWarnings en ese estado)",
      fn: () => {
        const artifact = { v2: { status: "pending_execution", promptFilePath: "/tmp/v2-prompt.md" } };
        assert.deepEqual(extractFabricationWarnings(artifact), []);
      },
    },
    {
      name: "extractFabricationWarnings devuelve [] cuando v2.status es invalid_output",
      fn: () => {
        const artifact = { v2: { status: "invalid_output", error: "boom", rawOutputPath: "/tmp/raw.json" } };
        assert.deepEqual(extractFabricationWarnings(artifact), []);
      },
    },
    {
      name: "extractFabricationWarnings (fail-safe) devuelve [] con input no-objeto",
      fn: () => {
        assert.deepEqual(extractFabricationWarnings(null), []);
        assert.deepEqual(extractFabricationWarnings("texto"), []);
        assert.deepEqual(extractFabricationWarnings(42), []);
      },
    },
    {
      name: "extractFabricationWarnings (fail-safe) devuelve [] si falta el campo v2 por completo",
      fn: () => {
        assert.deepEqual(extractFabricationWarnings({}), []);
      },
    },
    {
      name: "extractFabricationWarnings (fail-safe) devuelve [] si fabricationWarnings no es un array",
      fn: () => {
        const artifact = { v2: { status: "executed", fabricationWarnings: "no es un array" } };
        assert.deepEqual(extractFabricationWarnings(artifact), []);
      },
    },
    {
      name: "extractFabricationWarnings (fail-safe) filtra elementos que no sean string dentro del array",
      fn: () => {
        const artifact = { v2: { status: "executed", fabricationWarnings: ["warning valido", 42, null, "otro warning valido"] } };
        assert.deepEqual(extractFabricationWarnings(artifact), ["warning valido", "otro warning valido"]);
      },
    },
  ];
}
