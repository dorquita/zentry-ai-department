/**
 * Validador de un subconjunto MUY reducido de JSON Schema draft-07 -- sin
 * dependencias nuevas (mismo principio que validateV2Output() en
 * src/core/landing-architect-comparison.ts: "sin librerias externas").
 *
 * Modulo GENERICO (sin conocimiento de ningun dominio de negocio) --
 * ver docs/claude-employee-runtime.md. Usado en dos capas:
 *
 *   1. src/core/claude-employee-runtime.ts -- resolveClaudeEmployeeOutput(),
 *      el runtime comun de CUALQUIER empleado Claude: valida contra el
 *      JSON Schema versionado propio de CADA empleado (nunca uno
 *      hardcodeado aqui), tanto si la salida vino de `structured_output`
 *      (caso A, ya validado tambien dentro de claude-code-action por el
 *      Claude Agent SDK) como si se recupero del `execution_file`
 *      (caso B) -- exigiendo el MISMO contrato en ambos caminos,
 *      incluido `additionalProperties: false`, para que un JSON con
 *      campos extra que --json-schema habria rechazado en el caso A no
 *      pueda colarse por el caso B.
 *   2. test/landing-architect-v2-output-schema.test.ts -- test de deriva
 *      (drift), especifico del primer empleado, entre
 *      config/landing-architect-v2-output.schema.json y la interfaz
 *      TypeScript LandingArchitectV2Output / validateV2Output().
 *
 * Soporta el subconjunto de JSON Schema draft-07 que exige el Claude
 * Agent SDK: type (object/array/string/boolean/number), properties,
 * required, items, enum, additionalProperties: false, y $ref interno
 * resuelto contra rootSchema.definitions. Mas las keywords de anotacion
 * puramente documentales ($schema, $id, title, description), que nunca
 * restringen la validacion y por tanto nunca pueden romper la paridad
 * entre caso A y caso B.
 *
 * FAIL-CLOSED tambien a nivel de SCHEMA (no solo de datos): con 7
 * empleados creando schemas en paralelo, una keyword real de JSON Schema
 * no implementada aqui (p.ej. minLength, pattern, oneOf, format) podria
 * colarse en el schema de un empleado nuevo. Si eso pasara, `--json-schema`
 * SI la aplicaria (case A, validada dentro de claude-code-action por el
 * Claude Agent SDK), pero este validador la ignoraria en silencio en el
 * fallback (case B) -- rompiendo la paridad de contrato entre ambos
 * caminos sin que nadie se diera cuenta. `assertJsonSchemaLiteSupported()`
 * existe exactamente para impedir eso: recorre el schema completo
 * (root/properties/items/definitions, siguiendo $ref) y LANZA si
 * encuentra cualquier keyword que no este en la lista de soportadas --
 * nunca la ignora silenciosamente. Se ejecuta como preflight ANTES de
 * invocar a Claude (ver .github/actions/claude-employee-runtime/action.yml,
 * scripts/assert-json-schema-lite-compatible-for-ci.ts) para no gastar
 * inferencia con un schema que este runtime no puede validar con
 * paridad. Si un empleado necesita de verdad una keyword no soportada,
 * hay que implementarla aqui (y sus tests) en el mismo commit, para
 * TODOS los empleados que usan este runtime -- nunca dejar que se cuele
 * sin mas.
 */
export type JsonSchemaLite = {
  type?: string;
  properties?: Record<string, JsonSchemaLite>;
  required?: string[];
  items?: JsonSchemaLite;
  enum?: unknown[];
  additionalProperties?: boolean;
  $ref?: string;
  definitions?: Record<string, JsonSchemaLite>;
};

function resolveRef(schema: JsonSchemaLite, root: JsonSchemaLite): JsonSchemaLite {
  if (!schema.$ref) return schema;
  const match = schema.$ref.match(/^#\/definitions\/(.+)$/);
  if (!match) {
    throw new Error(`json-schema-lite: $ref no soportado (solo #/definitions/<nombre>): "${schema.$ref}"`);
  }
  const resolved = root.definitions?.[match[1]];
  if (!resolved) {
    throw new Error(`json-schema-lite: $ref apunta a una definicion inexistente: "${schema.$ref}"`);
  }
  return resolved;
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateAgainstSchema(schema: JsonSchemaLite, root: JsonSchemaLite, value: unknown, pathLabel = "$"): string[] {
  const resolved = resolveRef(schema, root);
  const errors: string[] = [];

  if (resolved.enum) {
    if (!resolved.enum.includes(value as never)) {
      errors.push(`${pathLabel}: valor "${String(value)}" no esta en enum [${resolved.enum.join(", ")}]`);
    }
    return errors;
  }

  if (resolved.type && typeOf(value) !== resolved.type) {
    errors.push(`${pathLabel}: se esperaba type "${resolved.type}", encontrado "${typeOf(value)}"`);
    return errors;
  }

  if (resolved.type === "object" && resolved.properties) {
    const obj = value as Record<string, unknown>;
    for (const requiredKey of resolved.required ?? []) {
      if (!(requiredKey in obj)) {
        errors.push(`${pathLabel}: falta la propiedad requerida "${requiredKey}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(resolved.properties)) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(propSchema, root, obj[key], `${pathLabel}.${key}`));
      }
    }
    if (resolved.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in resolved.properties)) {
          errors.push(`${pathLabel}: propiedad no declarada en el schema ("additionalProperties: false"): "${key}"`);
        }
      }
    }
  }

  if (resolved.type === "array" && resolved.items) {
    const arr = value as unknown[];
    arr.forEach((item, index) => {
      errors.push(...validateAgainstSchema(resolved.items as JsonSchemaLite, root, item, `${pathLabel}[${index}]`));
    });
  }

  return errors;
}

/**
 * Keywords de anotacion puramente documentales: nunca restringen la
 * validacion (json-schema-lite ni las lee), asi que nunca pueden romper
 * la paridad entre caso A (--json-schema) y caso B (fallback). Se
 * permiten en cualquier nivel del schema.
 */
const ALWAYS_SAFE_ANNOTATION_KEYWORDS = new Set(["$schema", "$id", "title", "description"]);

/** Keywords estructurales que este validador SI implementa (ver validateAgainstSchema/resolveRef mas arriba). */
const SUPPORTED_STRUCTURAL_KEYWORDS = new Set(["type", "properties", "required", "items", "enum", "additionalProperties", "$ref", "definitions"]);

const SUPPORTED_SCHEMA_KEYWORDS = new Set([...SUPPORTED_STRUCTURAL_KEYWORDS, ...ALWAYS_SAFE_ANNOTATION_KEYWORDS]);

function typeOfForSchemaCheck(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Verifica RECURSIVAMENTE (root, properties, items, definitions) que un
 * JSON Schema solo usa keywords que este validador implementa
 * (SUPPORTED_SCHEMA_KEYWORDS). Lanza -- nunca ignora en silencio -- ante
 * la primera keyword no soportada que encuentre, con la ruta exacta
 * dentro del schema para poder localizarla. No valida DATOS (eso es
 * validateAgainstSchema): esto valida el propio SCHEMA, como preflight
 * antes de confiar en que caso A y caso B validaran con el mismo
 * criterio.
 */
export function assertJsonSchemaLiteSupported(schema: unknown, pathLabel = "$"): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`json-schema-lite: se esperaba un objeto JSON Schema en ${pathLabel}, encontrado "${typeOfForSchemaCheck(schema)}".`);
  }

  const obj = schema as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      throw new Error(
        `json-schema-lite: la keyword de JSON Schema "${key}" (en ${pathLabel}) no esta soportada por este validador minimo. ` +
          `Si --json-schema la aplicara pero este validador la ignorara, caso A (structured_output) y caso B (fallback via execution_file) ` +
          `dejarian de tener el mismo contrato. Amplia src/core/json-schema-lite.ts (y sus tests) en el mismo commit si de verdad hace falta, ` +
          `o quita la keyword del schema.`,
      );
    }
  }

  if (obj.properties !== undefined) {
    if (obj.properties === null || typeof obj.properties !== "object" || Array.isArray(obj.properties)) {
      throw new Error(`json-schema-lite: "properties" en ${pathLabel} deberia ser un objeto.`);
    }
    for (const [key, propSchema] of Object.entries(obj.properties as Record<string, unknown>)) {
      assertJsonSchemaLiteSupported(propSchema, `${pathLabel}.properties.${key}`);
    }
  }

  if (obj.items !== undefined) {
    assertJsonSchemaLiteSupported(obj.items, `${pathLabel}.items`);
  }

  if (obj.definitions !== undefined) {
    if (obj.definitions === null || typeof obj.definitions !== "object" || Array.isArray(obj.definitions)) {
      throw new Error(`json-schema-lite: "definitions" en ${pathLabel} deberia ser un objeto.`);
    }
    for (const [key, defSchema] of Object.entries(obj.definitions as Record<string, unknown>)) {
      assertJsonSchemaLiteSupported(defSchema, `${pathLabel}.definitions.${key}`);
    }
  }
}
