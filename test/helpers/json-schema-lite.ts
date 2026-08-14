/**
 * Validador de un subconjunto MUY reducido de JSON Schema draft-07 -- sin
 * dependencias nuevas (mismo principio que validateV2Output() en
 * src/core/landing-architect-comparison.ts: "sin librerias externas").
 *
 * Existe UNICAMENTE para el test de deriva (drift) entre
 * config/landing-architect-v2-output.schema.json y la interfaz TypeScript
 * LandingArchitectV2Output (ver test/landing-architect-v2-output-schema.test.ts)
 * -- nunca se usa en runtime de produccion. La validacion "real" del JSON
 * Schema la hace el propio Claude Agent SDK dentro de claude-code-action
 * (--json-schema), no este codigo.
 *
 * Soporta solo lo que usa config/landing-architect-v2-output.schema.json:
 * type (object/array/string/boolean/number), properties, required, items,
 * enum, additionalProperties: false, y $ref interno resuelto contra
 * rootSchema.definitions. Cualquier otra feature de JSON Schema no
 * declarada aqui simplemente se ignora (no es un validador de proposito
 * general).
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
