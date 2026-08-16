import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

/**
 * Fase O53 — guardia automatico de independencia del VPS.
 *
 * Estos tests convierten la auditoria de `docs/vps-retirement-audit.md`
 * en algo que falla solo si alguien reintroduce una dependencia del VPS
 * legacy `/opt/zentry-ai-department`. Sin ellos, la independencia seria
 * una afirmacion de un documento que envejece; con ellos, es una
 * propiedad que CI comprueba en cada PR.
 *
 * La distincion que hacen es la que pidio la auditoria: una referencia
 * HISTORICA o de DOCUMENTACION a `/opt/...` es inofensiva (los eventos
 * ya commiteados guardan rutas absolutas de la maquina que los genero, y
 * eso no se puede ni se debe reescribir); una dependencia de RUNTIME —
 * codigo alcanzable que lee o escribe en esa ruta — si bloquea la
 * retirada.
 */

export interface TestCase {
  name: string;
  fn: () => void;
}

const ROOT = path.join(__dirname, "..");
const VPS_PATH = "/opt/zentry-ai-department";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/**
 * Quita comentarios de bloque y de linea. Una ruta del VPS citada en un
 * comentario que EXPLICA por que ya no se depende de ella no es una
 * dependencia -- confundir las dos cosas haria imposible documentar la
 * migracion.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listFiles(dir: string, ext: string[]): string[] {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
        continue;
      }
      if (ext.some((e) => entry.name.endsWith(e))) out.push(path.relative(ROOT, full));
    }
  };
  walk(absolute);
  return out;
}

/** Scripts realmente alcanzables: los que `npm run <algo>` puede lanzar. */
function scriptsReachableFromPackageJson(): string[] {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const found = new Set<string>();
  for (const command of Object.values(pkg.scripts)) {
    for (const match of command.matchAll(/scripts\/[A-Za-z0-9._-]+/g)) {
      found.add(match[0]);
    }
  }
  return [...found].filter((rel) => fs.existsSync(path.join(ROOT, rel)));
}

function workflowFiles(): string[] {
  return listFiles(".github/workflows", [".yml", ".yaml"]);
}

export function runVpsIndependenceTests(): TestCase[] {
  return [
    // ---------------------------------------------------------------
    // Dependencias de runtime sobre la ruta del VPS
    // ---------------------------------------------------------------
    {
      name: "VPS_RUNTIME_DEPENDENCIES = 0 en src/: ningun modulo de produccion lee ni escribe en /opt/zentry-ai-department",
      fn: () => {
        const offenders = listFiles("src", [".ts"]).filter((rel) =>
          stripComments(read(rel)).includes(VPS_PATH)
        );
        assert.deepEqual(
          offenders,
          [],
          `Estos modulos de src/ dependen en runtime del VPS legacy: ${offenders.join(", ")}`
        );
      },
    },
    {
      name: "VPS_RUNTIME_DEPENDENCIES = 0 en los scripts alcanzables por npm run",
      fn: () => {
        const offenders = scriptsReachableFromPackageJson().filter((rel) =>
          stripComments(read(rel)).includes(VPS_PATH)
        );
        assert.deepEqual(
          offenders,
          [],
          `Estos scripts son lanzables con npm run y dependen del VPS legacy: ${offenders.join(", ")}`
        );
      },
    },
    {
      name: "VPS_RUNTIME_DEPENDENCIES = 0 en los workflows: ningun step referencia la ruta del VPS",
      fn: () => {
        const offenders = workflowFiles().filter((rel) => read(rel).includes(VPS_PATH));
        assert.deepEqual(offenders, [], `Workflows que referencian el VPS: ${offenders.join(", ")}`);
      },
    },
    {
      name: "las referencias historicas a /opt/... siguen permitidas: no se exige reescribir el pasado",
      fn: () => {
        // src/employees/analytics-specialist/context.ts documenta en un
        // comentario que los eventos ya commiteados guardan la ruta
        // absoluta del VPS, y por eso el lector prueba primero la ruta
        // LOCAL. Ese comentario debe poder existir sin romper el guardia
        // de arriba -- si esta comprobacion falla, es que stripComments()
        // dejo de funcionar y los tests anteriores se han vuelto ciegos.
        const source = read("src/employees/analytics-specialist/context.ts");
        assert.ok(source.includes(VPS_PATH), "el comentario historico deberia seguir ahi");
        assert.equal(
          stripComments(source).includes(VPS_PATH),
          false,
          "stripComments() no esta quitando el comentario: los guardias de runtime serian falsos positivos"
        );
      },
    },

    // ---------------------------------------------------------------
    // Todas las fuentes externas se leen desde Actions
    // ---------------------------------------------------------------
    {
      name: "las cuatro fuentes Google se leen en vivo dentro de la pasada diaria, con el mismo departmentRunId",
      fn: () => {
        const daily = read(".github/workflows/zentry-ai-department-daily.yml");
        for (const watcher of ["seo:watch", "analytics:watch", "sem:watch"]) {
          assert.ok(
            daily.includes(`npm run ${watcher} -- --departmentRunId "$DEPARTMENT_RUN_ID" --require-live`),
            `${watcher} no se ejecuta en vivo dentro de la pasada diaria`
          );
        }
      },
    },
    {
      name: "los informes diarios (growth-director v1) se generan dentro de la pasada, no se heredan del VPS",
      fn: () => {
        const daily = read(".github/workflows/zentry-ai-department-daily.yml");
        assert.match(daily, /npm run growth:daily -- --departmentRunId "\$DEPARTMENT_RUN_ID" --skip-watchers --no-email/);
      },
    },
    {
      name: "el pipeline de Actions no habilita ninguna escritura: los agentes que escriben siguen fail-closed",
      fn: () => {
        const daily = read(".github/workflows/zentry-ai-department-daily.yml");
        // El step [GROWTH-V1] corre los 26 agentes, incluidos los que
        // pueden escribir. Su salvaguarda es que NO se les da la variable
        // que los habilita; si alguien la anadiera aqui, la pasada diaria
        // pasaria a escribir en WordPress sin que nadie lo decidiera.
        for (const flag of [
          "WORDPRESS_DRAFTS_ENABLED",
          "STAGING_EXECUTION_ENABLED",
          "PRODUCTION_EXECUTION_ENABLED",
          "PRODUCTION_DRAFTS_ENABLED",
        ]) {
          const growthPhase = daily
            .slice(
              daily.indexOf("[GROWTH-V1] Pipeline determinista"),
              daily.indexOf("FASE 1 -- ESPECIALISTAS")
            )
            // Se quitan los comentarios YAML: el step DOCUMENTA que no
            // inyecta estas variables, y esa frase no puede hacer fallar
            // el test que comprueba justo eso. Lo que se busca es una
            // ASIGNACION real (`FLAG: ...`), no una mencion.
            .split("\n")
            .filter((line) => !line.trim().startsWith("#"))
            .join("\n");
          assert.equal(
            new RegExp(`^\\s*${flag}\\s*:`, "m").test(growthPhase),
            false,
            `el step [GROWTH-V1] no puede inyectar ${flag}: convertiria la pasada diaria en un escritor`
          );
        }
      },
    },

    // ---------------------------------------------------------------
    // La dependencia INDIRECTA que sigue viva: persistencia de estado
    // ---------------------------------------------------------------
    {
      name: "queda documentado que ningun workflow persiste estado todavia (dependencia indirecta conocida)",
      fn: () => {
        // Este test NO exige que se persista: exige que la situacion real
        // este reflejada, para que nadie declare la independencia
        // terminada mientras el estado siga sin escribirse. El dia que se
        // habilite el commit-back, este test se actualiza a la vez que el
        // workflow -- a proposito, para que sea un cambio consciente.
        const daily = read(".github/workflows/zentry-ai-department-daily.yml");
        const persists = daily.includes("contents: write");
        const audit = read("docs/vps-retirement-audit.md");
        if (!persists) {
          assert.match(
            audit,
            /PERSISTENCIA DE ESTADO/,
            "si la pasada diaria no persiste estado, la auditoria debe decirlo explicitamente"
          );
        }
      },
    },
    {
      name: "la auditoria de retirada existe y enumera las capacidades auditadas",
      fn: () => {
        const audit = read("docs/vps-retirement-audit.md");
        for (const capability of [
          "Search Console",
          "GA4",
          "GTM",
          "Google Ads",
          "WordPress",
          "SMTP",
          "Growth Director",
          "systemd",
          "cron",
        ]) {
          assert.ok(audit.includes(capability), `la auditoria no cubre "${capability}"`);
        }
      },
    },
  ];
}
