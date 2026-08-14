/**
 * Validador de un subconjunto MUY reducido de JSON Schema draft-07 -- sin
 * dependencias nuevas (mismo principio que validateV2Output() en
 * src/core/landing-architect-comparison.ts: "sin librerias externas").
 *
 * Usado en DOS sitios, sobre el MISMO fichero
 * config/landing-architect-v2-output.schema.json (una unica definicion
 * del contrato, nunca dos mantenidas a mano por separado):
 *
 *   1. test/landing-architect-v2-output-schema.test.ts -- test de deriva
 *      (drift) entre el schema y la interfaz TypeScript
 *      LandingArchitectV2Output / validateV2Output().
 *   2. src/core/execution-file-result-extractor.ts -- validacion en
 *      RUNTIME del fallback (caso B: structured_output ausente, se
 *      recupera el resultado del execution_file). El camino normal
 *      (caso A) ya pasa por esta misma validacion dentro de
 *      claude-code-action, hecha por el Claude Agent SDK contra este
 *      mismo fichero de schema (--json-schema); el fallback deberia
 *      exigir EXACTAMENTE el mismo contrato, incluido
 *      `additionalProperties: false` -- sin esto, un JSON con campos
 *      extra que --json-schema habria rechazado en el caso A podria
 *      colarse por el caso B, relajando el contrato sin querer.
 *
 * Soporta solo lo que usa config/landing-architect-v2-output.schema.json:
 * type (object/array/string/boolean/number), properties, required, items,
 * enum, additionalProperties: false, y $ref interno resuelto contra
 * rootSchema.definitions. Cualquier otra feature de JSON Schema no
 * declarada aqui simplemente se ignora (no es un validador de proposito
 * general) -- si config/landing-architect-v2-output.schema.json llegara a
 * necesitar una feature no soportada aqui, hay que ampliar este modulo
 * (y sus tests) en el mismo commit.
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
