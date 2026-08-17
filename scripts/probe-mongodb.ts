/**
 * Fase O56 — sonda de MongoDB para GitHub Actions.
 *
 *   npm run state:probe-mongodb
 *   npm run state:probe-mongodb -- --write-check
 *
 * Secuencia: conectar -> ping -> comprobar la base -> (opcional)
 * operacion read/write controlada -> exito.
 *
 * FAIL-CLOSED: si falta `MONGODB_URI` o algo falla, sale con codigo != 0.
 * Un workflow que necesita MongoDB no debe continuar creyendo que hay
 * persistencia cuando no la hay.
 *
 * SIN CONTENIDO SENSIBLE EN LOGS: lo unico que imprime sobre el destino
 * es esquema, numero de hosts y nombre de base de datos. La URI no sale
 * de `src/persistence/mongo-config.ts` bajo ninguna circunstancia, y todo
 * mensaje de error pasa por el saneador.
 *
 * La comprobacion de escritura opcional NO toca estado del departamento:
 * escribe en `state_migrations`, que es la bitacora de la herramienta de
 * migracion, y lo hace dos veces a proposito para demostrar in situ que
 * el indice unico impide el duplicado.
 */
import { MIGRATIONS_COLLECTION } from "../src/persistence/collections";
import {
  describeCredentialShape,
  describeMongoTarget,
  loadMongoConfig,
  looksLikeMissingAuthSource,
  renderMongoTarget,
  sanitizeMongoText,
} from "../src/persistence/mongo-config";
import { connectStateDatabase } from "../src/persistence/mongo-database";
import {
  MongoPersistenceError,
  classifyMongoError,
  troubleshootingHints,
} from "../src/persistence/mongo-errors";
import { COLLECTION_SPECS } from "../src/persistence/collections";
import { MongoStateDatabase } from "../src/persistence/mongo-database";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : "true";
  }
  return args;
}

async function runWriteCheck(database: MongoStateDatabase): Promise<void> {
  const collection = database.collection(MIGRATIONS_COLLECTION);
  // Un id por dia: la sonda se puede lanzar muchas veces sin acumular basura.
  const migrationRunId = `probe-${new Date().toISOString().slice(0, 10)}`;
  const document = { migrationRunId, kind: "probe", checkedAt: new Date().toISOString() };

  const first = await collection.insertIfAbsent({ migrationRunId }, document);
  const second = await collection.insertIfAbsent({ migrationRunId }, document);

  if (second.result !== "duplicate_prevented") {
    throw new Error(
      `El indice unico de ${MIGRATIONS_COLLECTION} no esta impidiendo duplicados: la segunda escritura ` +
        `devolvio "${second.result}" en vez de "duplicate_prevented".`
    );
  }

  const readBack = await collection.findOne({ migrationRunId });
  if (!readBack) {
    throw new Error("La escritura de prueba no se pudo releer. La base no esta confirmando escrituras.");
  }

  console.log(`[probe] escritura controlada: primera=${first.result}, segunda=${second.result} (correcto).`);
  console.log("[probe] relectura correcta.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const config = loadMongoConfig();
  const target = describeMongoTarget(config);
  console.log(`[probe] destino: ${renderMongoTarget(target)}`);

  // Se avisa ANTES de conectar: si la sospecha es correcta, la conexion
  // va a fallar dentro de un segundo y este aviso es la explicacion.
  if (looksLikeMissingAuthSource(target)) {
    console.warn(
      "[probe] AVISO: la URI trae base de datos en la ruta y NO fija authSource. Por especificacion, " +
        "el driver autenticara contra esa base y no contra `admin` — que es donde Atlas crea los " +
        "usuarios. Si la autenticacion falla, esta es la primera sospecha."
    );
  }

  const database = await connectStateDatabase(config);
  try {
    await database.ping();
    console.log("[probe] ping correcto.");

    await database.ensureIndexes();
    console.log(`[probe] indices asegurados en ${COLLECTION_SPECS.length} coleccion(es).`);

    for (const spec of COLLECTION_SPECS) {
      const count = await database.collection(spec.name).count({});
      console.log(`[probe] ${spec.name}: ${count} documento(s).`);
    }

    if (args["write-check"] === "true") {
      await runWriteCheck(database);
    } else {
      console.log("[probe] sin comprobacion de escritura (pasa --write-check para incluirla).");
    }

    console.log("[probe] MONGODB_PROBE=ok");
  } finally {
    await database.close();
  }
}

main().catch((err) => {
  console.error(`[probe] MONGODB_PROBE=fail`);
  console.error(sanitizeMongoText(err));

  // El mensaje del servidor dice QUE ha fallado, no POR QUE. Las causas
  // reales de cada tipo son pocas y concretas, asi que se enumeran aqui
  // en vez de dejar que el siguiente las vuelva a deducir.
  const kind = err instanceof MongoPersistenceError ? err.kind : classifyMongoError(err);
  const hints = troubleshootingHints(kind);
  if (hints.length > 0) {
    console.error("");
    console.error(`[probe] Fallo de tipo "${kind}". Que comprobar:`);
    for (const hint of hints) console.error(`[probe]   ${hint}`);
  }
  if (kind === "auth_failure") {
    try {
      const config = loadMongoConfig();
      if (looksLikeMissingAuthSource(describeMongoTarget(config))) {
        console.error("");
        console.error(
          "[probe] SOSPECHA PRINCIPAL: la URI trae base de datos en la ruta y no fija authSource, asi " +
            "que el driver ha autenticado contra esa base en vez de contra `admin`. Anadir el parametro " +
            "authSource con valor admin al final de la URI suele arreglarlo de una."
        );
      }

      // Radiografia de la forma de las credenciales. Solo booleanos: estas
      // tres causas son invisibles mirando la consola de Atlas, porque
      // estan en la cadena y no en el usuario.
      const shape = describeCredentialShape(config.uri);
      console.error("");
      console.error(
        `[probe] forma de las credenciales: placeholder=${shape.hasPlaceholder} ` +
          `caracteres_crudos=${shape.hasRawSpecialChars} ` +
          `secuencias_percent=${shape.hasPercentEscapes} ` +
          `alguna_parte_vacia=${shape.hasEmptyPart}`
      );
      if (shape.hasPlaceholder) {
        console.error(
          "[probe] CAUSA ENCONTRADA: la URI todavia lleva un placeholder sin sustituir (el <db_password> " +
            "que Atlas deja en la cadena que te copia). Se esta enviando ese texto literal como contrasena."
        );
      }
      if (shape.hasEmptyPart) {
        console.error("[probe] CAUSA ENCONTRADA: el usuario o la contrasena estan vacios en la URI.");
      }
      if (shape.hasRawSpecialChars) {
        console.error(
          "[probe] CAUSA PROBABLE: hay caracteres crudos en la parte de credenciales que MongoDB exige " +
            "percent-encodear. La contrasena que viaja no es la que crees."
        );
      }
      if (shape.hasPercentEscapes) {
        console.error(
          "[probe] A COMPROBAR: la URI contiene secuencias %XX. Si son intencionadas, bien. Si la " +
            "contrasena real lleva un % literal y no se escribio como %25, el driver esta decodificando " +
            "de mas y autenticando con otra cosa."
        );
      }
    } catch {
      // Si ni siquiera se puede releer la configuracion, el fallo ya
      // estaba explicado antes: no se añade ruido.
    }
    console.error("");
    console.error(
      "[probe] Este fallo NO se reintenta: reintentar con las mismas credenciales da el mismo resultado."
    );
  }

  process.exit(1);
});
