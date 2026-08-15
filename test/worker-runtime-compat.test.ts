import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

export interface TestCase {
  name: string;
  fn: () => void;
}

const PROJECT_ROOT = path.join(__dirname, "..");
const WORKER_ENTRY = path.join(PROJECT_ROOT, "src", "worker", "index.ts");

/**
 * El runtime de Cloudflare Workers NO es Node: no existen `fs`, `path`,
 * `crypto` (el de Node), `Buffer` ni `process`. Un import de esos, aunque
 * sea TRANSITIVO y aunque el codigo nunca lo ejecute, rompe el bundle en
 * el momento del deploy -- es decir, se descubre tarde y en el peor
 * momento.
 *
 * Este guard recorre el grafo COMPLETO de imports desde el entrypoint del
 * Worker y falla en CI si aparece cualquiera de ellos. Existe por un caso
 * real: `telegram-message.ts` importaba `shortHash` de `./version`, que
 * importa `node:crypto` para calcular hashes que el Worker no necesita.
 * Nada en los tests unitarios lo detectaba, porque los tests corren en
 * Node y ahi todo existe.
 */

const NODE_BUILTINS = [
  "fs",
  "node:fs",
  "path",
  "node:path",
  "crypto",
  "node:crypto",
  "os",
  "node:os",
  "child_process",
  "node:child_process",
  "http",
  "https",
  "net",
  "stream",
  "dotenv",
  "nodemailer",
  "googleapis",
];

/** Globals que solo existen en Node y que tampoco pueden aparecer en el grafo del Worker. */
const NODE_ONLY_GLOBALS = [/\bBuffer\./, /\bprocess\.env\b/, /\b__dirname\b/, /\brequire\(/];

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

interface GraphNode {
  file: string;
  /** Cadena de imports desde el entrypoint hasta este fichero, para poder senalar al culpable. */
  chain: string[];
}

/** Recorre el grafo de imports desde el entrypoint del Worker. */
function walkWorkerGraph(): { files: GraphNode[]; violations: string[] } {
  const seen = new Set<string>();
  const files: GraphNode[] = [];
  const violations: string[] = [];
  const queue: GraphNode[] = [{ file: WORKER_ENTRY, chain: ["src/worker/index.ts"] }];

  while (queue.length > 0) {
    const node = queue.shift() as GraphNode;
    if (seen.has(node.file)) continue;
    seen.add(node.file);
    files.push(node);

    const content = fs.readFileSync(node.file, "utf-8");
    const specifiers = [...content.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    const bareImports = [...content.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)].map((m) => m[1]);

    for (const specifier of [...specifiers, ...bareImports]) {
      if (NODE_BUILTINS.includes(specifier)) {
        violations.push(`${node.chain.join(" -> ")} importa "${specifier}", que no existe en el runtime de Cloudflare Workers.`);
        continue;
      }
      const resolved = resolveImport(node.file, specifier);
      if (resolved) {
        queue.push({ file: resolved, chain: [...node.chain, path.relative(PROJECT_ROOT, resolved).split(path.sep).join("/")] });
      }
    }
  }
  return { files, violations };
}

export function runWorkerRuntimeCompatTests(): TestCase[] {
  return [
    {
      name: "Ningun modulo alcanzable desde el Worker importa un builtin de Node (romperia el deploy, no los tests)",
      fn: () => {
        assert.ok(fs.existsSync(WORKER_ENTRY), "falta src/worker/index.ts");
        const { violations, files } = walkWorkerGraph();
        assert.equal(violations.length, 0, `El grafo del Worker arrastra dependencias de Node:\n  - ${violations.join("\n  - ")}`);
        assert.ok(files.length > 1, "el recorrido del grafo no encontro imports: revisar el parser antes de fiarse de este guard");
      },
    },
    {
      name: "Ningun modulo del Worker usa Buffer, process.env, __dirname ni require()",
      fn: () => {
        const { files } = walkWorkerGraph();
        const problems: string[] = [];
        for (const node of files) {
          const content = fs
            .readFileSync(node.file, "utf-8")
            // Los comentarios pueden nombrar `process.env` al explicar por
            // que NO se usa: no son codigo y no rompen el bundle.
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|\s)\/\/.*$/gm, "");
          for (const pattern of NODE_ONLY_GLOBALS) {
            if (pattern.test(content)) problems.push(`${node.chain.join(" -> ")} usa ${String(pattern)}`);
          }
        }
        assert.equal(problems.length, 0, `Globals de Node en el grafo del Worker:\n  - ${problems.join("\n  - ")}`);
      },
    },
    {
      name: "El Worker NUNCA alcanza WordPress: ni adaptadores, ni executors que escriban",
      fn: () => {
        const { files } = walkWorkerGraph();
        const reachable = files.map((f) => path.relative(PROJECT_ROOT, f.file).split(path.sep).join("/"));
        for (const forbidden of ["src/adapters/", "src/department/apply/staging-executor.ts", "src/department/apply/production-executor.ts"]) {
          const hit = reachable.find((f) => f.startsWith(forbidden) || f === forbidden);
          assert.equal(
            hit,
            undefined,
            `El Worker alcanza "${hit}". La funcion serverless NO escribe en WordPress bajo ninguna circunstancia: encola y GitHub Actions publica.`
          );
        }
      },
    },
  ];
}
