import { JsonSchemaLite } from "./json-schema-lite";

/**
 * Renderiza, de forma DETERMINISTA y sin LLM, el contrato de salida de un
 * empleado Claude (que campos son obligatorios y cuales opcionales,
 * objeto a objeto) a partir de SU JSON Schema versionado -- el mismo
 * fichero que ya se pasa a `--json-schema` y contra el que valida el
 * runtime comun (src/core/claude-employee-runtime.ts).
 *
 * POR QUE EXISTE (incidente real, run 31949966340): las instrucciones de
 * `.claude/agents/<empleado>.md` son prosa escrita a mano, y la prosa
 * DERIVA del schema. En seo-specialist la frase que declaraba los campos
 * opcionales decia "`page` ... es opcional" sin decir en que objeto,
 * mientras el schema exigia `technicalIssues[].page`. El modelo hizo caso
 * a la prosa, omitio `page` en un problema tecnico que no era de ninguna
 * pagina concreta, y el runtime lo rechazo en cerrado: pasada en rojo,
 * sin ningun dato SEO. Un mismo prompt podia salir bien o mal segun si el
 * modelo topaba o no con ese caso -- de ahi la intermitencia.
 *
 * Insertar ESTE bloque (generado del schema, nunca escrito a mano) en el
 * prompt elimina la clase entera de fallo: el contrato que lee el modelo
 * y el contrato contra el que se valida su respuesta salen del MISMO
 * fichero, asi que no pueden contradecirse.
 *
 * Modulo GENERICO: no sabe nada de SEO ni de ningun otro dominio.
 */

/** Ancho maximo del enum que se imprime literal; por encima se resume (ningun schema del proyecto llega, pero evita un prompt absurdo si alguien anade uno enorme). */
const MAX_ENUM_VALUES_INLINE = 20;

function resolveRefLocal(schema: JsonSchemaLite, root: JsonSchemaLite): { resolved: JsonSchemaLite; definitionName?: string } {
  if (!schema.$ref) return { resolved: schema };
  const match = schema.$ref.match(/^#\/definitions\/(.+)$/);
  if (!match) throw new Error(`schema-contract-summary: $ref no soportado (solo #/definitions/<nombre>): "${schema.$ref}"`);
  const resolved = root.definitions?.[match[1]];
  if (!resolved) throw new Error(`schema-contract-summary: $ref apunta a una definicion inexistente: "${schema.$ref}"`);
  return { resolved, definitionName: match[1] };
}

/** Descripcion corta del TIPO de un campo, ya resuelto el $ref: "string", "number", "uno de: a | b", "array de string", "array de <finding>", "objeto <details>". */
function describeFieldType(schema: JsonSchemaLite, root: JsonSchemaLite): string {
  const { resolved, definitionName } = resolveRefLocal(schema, root);

  if (resolved.enum) {
    const values = resolved.enum.map((v) => String(v));
    if (values.length > MAX_ENUM_VALUES_INLINE) return `uno de ${values.length} valores permitidos`;
    return `uno de: ${values.join(" | ")}`;
  }

  if (resolved.type === "array") {
    if (!resolved.items) return "array";
    const { resolved: itemResolved, definitionName: itemDefinition } = resolveRefLocal(resolved.items, root);
    if (itemDefinition) return `array de objetos <${itemDefinition}>`;
    if (itemResolved.enum) return `array de valores del enum`;
    return `array de ${itemResolved.type ?? "elementos"}`;
  }

  if (resolved.type === "object") return definitionName ? `objeto <${definitionName}>` : "objeto";

  return resolved.type ?? "sin tipo declarado";
}

interface ObjectBlock {
  label: string;
  schema: JsonSchemaLite;
}

/** Recorre el schema en anchura y devuelve, en orden estable, cada objeto del contrato (raiz primero, luego las definiciones segun aparecen). */
function collectObjectBlocks(root: JsonSchemaLite): ObjectBlock[] {
  const blocks: ObjectBlock[] = [{ label: "objeto raiz (la respuesta completa)", schema: root }];
  const seenDefinitions = new Set<string>();
  const queue: ObjectBlock[] = [...blocks];

  while (queue.length > 0) {
    const current = queue.shift() as ObjectBlock;
    for (const propSchema of Object.values(current.schema.properties ?? {})) {
      const candidates: JsonSchemaLite[] = [propSchema];
      const { resolved } = resolveRefLocal(propSchema, root);
      if (resolved.type === "array" && resolved.items) candidates.push(resolved.items);

      for (const candidate of candidates) {
        const { resolved: candidateResolved, definitionName } = resolveRefLocal(candidate, root);
        if (!definitionName || seenDefinitions.has(definitionName)) continue;
        if (candidateResolved.type !== "object" || !candidateResolved.properties) continue;
        seenDefinitions.add(definitionName);
        const block: ObjectBlock = { label: `<${definitionName}>`, schema: candidateResolved };
        blocks.push(block);
        queue.push(block);
      }
    }
  }

  return blocks;
}

function renderBlock(block: ObjectBlock, root: JsonSchemaLite): string[] {
  const properties = block.schema.properties ?? {};
  const required = new Set(block.schema.required ?? []);
  const lines: string[] = [`**${block.label}**`, ""];

  const requiredNames = Object.keys(properties).filter((name) => required.has(name));
  const optionalNames = Object.keys(properties).filter((name) => !required.has(name));

  lines.push("- OBLIGATORIOS:");
  if (requiredNames.length === 0) {
    lines.push("  - (ninguno)");
  } else {
    for (const name of requiredNames) lines.push(`  - \`${name}\` (${describeFieldType(properties[name], root)})`);
  }

  lines.push("- OPCIONALES (omitelos si no aplican -- nunca \`null\`, nunca cadena vacia, nunca un valor inventado):");
  if (optionalNames.length === 0) {
    lines.push("  - (ninguno)");
  } else {
    for (const name of optionalNames) lines.push(`  - \`${name}\` (${describeFieldType(properties[name], root)})`);
  }

  if (block.schema.additionalProperties === false) {
    lines.push("- No se admite NINGUN campo adicional fuera de los listados (la respuesta se rechaza entera si aparece uno).");
  }

  lines.push("");
  return lines;
}

/**
 * Bloque markdown listo para insertar en el prompt de un empleado. La
 * salida es puramente funcion del schema: mismo schema -> mismo texto,
 * byte a byte (ningun timestamp, ningun orden aleatorio).
 */
export function renderSchemaContractSummary(root: JsonSchemaLite, schemaPathForHumans: string): string {
  const lines: string[] = [];
  lines.push(`Esta seccion NO esta escrita a mano: se genera automaticamente desde \`${schemaPathForHumans}\`, el MISMO JSON Schema contra el que se valida tu respuesta.`);
  lines.push("Si esta seccion y cualquier otra parte de las instrucciones se contradicen, manda SIEMPRE esta seccion.");
  lines.push("Una respuesta a la que le falte un campo OBLIGATORIO, o que traiga un campo no listado, se descarta ENTERA (no se aprovecha parcialmente).");
  lines.push("");

  for (const block of collectObjectBlocks(root)) {
    lines.push(...renderBlock(block, root));
  }

  return lines.join("\n").trimEnd();
}
