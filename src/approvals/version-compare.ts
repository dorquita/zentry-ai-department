/**
 * Comparacion de versiones SIN dependencias de runtime.
 *
 * Se separa de `src/department/apply/version.ts` (que importa
 * `node:crypto` para CALCULAR hashes) porque el Worker de Cloudflare no
 * es Node y no puede importar ese modulo. El Worker nunca calcula un
 * hash: solo compara identificadores opacos que ya vienen calculados por
 * quien si releyo el sistema real (GitHub Actions).
 */

export interface VersionMatchResult {
  matches: boolean;
  /** Siempre no vacio: por que coincide o por que no. */
  reason: string;
}

/** Version corta del hash para mensajes legibles. Nunca es un identificador de seguridad por si sola. */
export function shortHash(hash: string): string {
  return String(hash ?? "").slice(0, 12);
}

/**
 * Compara la version aprobada con la actual. Fail-closed: si falta
 * cualquiera de los dos hashes, NO coincide (nunca se interpreta un dato
 * ausente como "seguro que sigue igual").
 */
export function matchesApprovedVersion(approvedHash: string | null | undefined, currentHash: string | null | undefined): VersionMatchResult {
  if (!approvedHash || approvedHash.trim().length === 0) {
    return {
      matches: false,
      reason: "No hay hash de la version aprobada registrado. Fail-closed: no se puede afirmar que lo aprobado sea lo que hay en staging, asi que no se publica nada.",
    };
  }
  if (!currentHash || currentHash.trim().length === 0) {
    return { matches: false, reason: "No se pudo calcular el estado actual de staging. Fail-closed: sin poder comprobarlo, no se publica nada." };
  }
  if (approvedHash !== currentHash) {
    return {
      matches: false,
      reason: `Staging ha cambiado desde que se envio la solicitud de aprobacion (version aprobada ${shortHash(approvedHash)}, version actual ${shortHash(currentHash)}). La aprobacion ya no se refiere a lo que hay publicado: hace falta una aprobacion nueva sobre la version nueva.`,
    };
  }
  return { matches: true, reason: `La version aprobada (${shortHash(approvedHash)}) sigue siendo exactamente la que hay en staging.` };
}
