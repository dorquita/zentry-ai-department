/**
 * Fase O55 — CLI de la persistencia de estado del departamento.
 *
 * Dos modos, pensados para envolver una pasada de GitHub Actions:
 *
 *   npm run state:snapshot -- --out <fichero>
 *     Mide el estado ANTES de la pasada y guarda el manifiesto.
 *
 *   npm run state:verify -- --before <fichero>
 *     Vuelve a medir DESPUES y compara. Sale con codigo != 0 si algo se
 *     ha perdido -- fichero desaparecido, `.jsonl` con menos lineas, o
 *     fichero mas pequeno. Es la puerta que debe pasar el estado antes de
 *     commitearse a la rama de estado: si esta falla, NO se persiste
 *     nada y la rama conserva el ultimo estado bueno.
 *
 * Este script NO habla con git ni conoce ninguna rama: solo mide y
 * compara. Quien commitea es el workflow.
 */
import * as fs from "fs";
import * as path from "path";
import {
  StateManifest,
  captureStateManifest,
  classifyStateRegressions,
  detectStateRegressions,
  renderStateVerification,
} from "../src/core/state-persistence";

const PROJECT_ROOT = path.join(__dirname, "..");

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      const value = next && !next.startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;

  if (mode === "snapshot") {
    const out = args.out;
    if (!out || out === "true") {
      throw new Error("--mode snapshot requiere --out <fichero> donde escribir el manifiesto.");
    }
    const manifest = captureStateManifest(PROJECT_ROOT, new Date().toISOString());
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), JSON.stringify(manifest, null, 2), "utf-8");
    const jsonlLines = manifest.files.reduce((sum, f) => sum + (f.lines ?? 0), 0);
    console.log(
      `Manifiesto de estado escrito en ${out}: ${manifest.files.length} fichero(s), ${jsonlLines} linea(s) de estado.`
    );
    return;
  }

  if (mode === "verify") {
    const beforePath = args.before;
    if (!beforePath || beforePath === "true") {
      throw new Error("--mode verify requiere --before <fichero> (el manifiesto previo).");
    }
    if (!fs.existsSync(path.resolve(beforePath))) {
      throw new Error(
        `No existe el manifiesto previo "${beforePath}". Sin el no se puede demostrar que no se ha perdido nada: fail-closed.`
      );
    }
    // `--projection` lo pone el workflow cuando la pasada corre en modo
    // `mongo`. No se deduce del entorno a proposito: relajar un guard
    // tiene que ser una decision explicita y visible en el comando.
    const projection = args.projection === "true";
    const before = JSON.parse(fs.readFileSync(path.resolve(beforePath), "utf-8")) as StateManifest;
    const after = captureStateManifest(PROJECT_ROOT, new Date().toISOString());
    const regressions = detectStateRegressions(before, after);
    const classified = classifyStateRegressions(regressions);

    console.log(renderStateVerification(before, after, regressions));
    console.log("");

    // Fase O56 — solo `data/` bloquea. Un informe de `reports/` que se
    // regenera mas corto es normal (menos incidencias que ayer) y hasta
    // ahora tiraba TODO el estado nuevo de la pasada con el. Se sigue
    // informando, pero no decide.
    if (classified.artifact.length > 0) {
      console.log(
        `Aviso: ${classified.artifact.length} fichero(s) de \`reports/\` han encogido. Son entregables ` +
          `regenerables, no estado: NO bloquean la persistencia.`
      );
      for (const regression of classified.artifact) {
        console.log(`  - ${regression.path} (${regression.kind}): ${regression.detail}`);
      }
      console.log("");
    }

    console.log(
      `STATE_VERIFY_JSON=${JSON.stringify({
        regressions: regressions.length,
        stateRegressions: classified.state.length,
        artifactRegressions: classified.artifact.length,
        ok: classified.state.length === 0,
      })}`
    );

    // Fase O57 — cuando MongoDB es la fuente de verdad, `data/` NO es un
    // log append-only: es una PROYECCION que se regenera en cada pasada,
    // y por construccion tiene una linea por entidad en vez de una por
    // version. `action-backlog.jsonl` pasa de 6.271 lineas a 105 sin que
    // se pierda absolutamente nada -- las 6.166 restantes son versiones
    // antiguas de esas mismas 105 acciones, y el historico completo sigue
    // en `action-audit.jsonl` (clase B, que si es append-only) y en la
    // rama de estado, congelada e intacta.
    //
    // Aplicar aqui la regla append-only seria medir la proyeccion con la
    // vara del log. La invariante que SI aplica en ese modo es la de
    // MongoDB (`state:verify-mongodb`), que corre igualmente y es la que
    // decide. Esto no relaja el guard legacy: en modo legacy sigue
    // bloqueando exactamente igual que antes.
    if (projection) {
      console.log(
        `Modo proyeccion (MongoDB es la fuente de verdad): las ${classified.state.length} diferencia(s) en ` +
          "`data/` son el resultado de proyectar el estado actual, no una perdida. La invariante que decide " +
          "en este modo es `npm run state:verify-mongodb`."
      );
      return;
    }

    if (classified.state.length > 0) {
      console.error(
        `Se han detectado ${classified.state.length} regresion(es) en el ESTADO (\`data/\`). NO se persiste nada: la rama de estado conserva el ultimo estado bueno.`
      );
      process.exit(1);
    }
    return;
  }

  throw new Error(`--mode desconocido: "${mode ?? "(ausente)"}". Valores validos: "snapshot" o "verify".`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
