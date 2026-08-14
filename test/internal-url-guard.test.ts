import * as assert from "node:assert/strict";
import { isRealInternalUrl } from "../src/core/internal-url-guard";

export interface TestCase {
  name: string;
  fn: () => void;
}

const AUTHORIZED = new Set(["zentrylockers.com", "staging.zentrylockers.com"]);

export function runInternalUrlGuardTests(): TestCase[] {
  return [
    {
      name: "acepta un path relativo real",
      fn: () => {
        assert.equal(isRealInternalUrl("/taquillas-melamina/", AUTHORIZED), true);
      },
    },
    {
      name: "rechaza una URL protocol-relative disfrazada de path ('//host/algo')",
      fn: () => {
        assert.equal(isRealInternalUrl("//evil-tracker.com/algo", AUTHORIZED), false);
      },
    },
    {
      name: "acepta una URL absoluta de produccion (host autorizado exacto)",
      fn: () => {
        assert.equal(isRealInternalUrl("https://zentrylockers.com/taquillas-melamina/", AUTHORIZED), true);
      },
    },
    {
      name: "acepta una URL absoluta de staging (host autorizado exacto)",
      fn: () => {
        assert.equal(isRealInternalUrl("https://staging.zentrylockers.com/taquillas-melamina/", AUTHORIZED), true);
      },
    },
    {
      name: "rechaza un dominio externo cualquiera",
      fn: () => {
        assert.equal(isRealInternalUrl("https://competidor-ejemplo.com/taquillas/", AUTHORIZED), false);
      },
    },
    {
      name: "rechaza un host que solo CONTIENE el dominio autorizado como sufijo/prefijo (bypass por subcadena)",
      fn: () => {
        assert.equal(isRealInternalUrl("https://zentrylockers.com.evil.com/x", AUTHORIZED), false);
        assert.equal(isRealInternalUrl("https://not-zentrylockers.com/x", AUTHORIZED), false);
        assert.equal(isRealInternalUrl("https://evil-zentrylockers.com/x", AUTHORIZED), false);
      },
    },
    {
      name: "rechaza un subdominio no autorizado explicitamente (solo staging.* esta en la lista, no cualquier subdominio)",
      fn: () => {
        assert.equal(isRealInternalUrl("https://blog.zentrylockers.com/x", AUTHORIZED), false);
      },
    },
    {
      name: "rechaza texto vacio o solo espacios",
      fn: () => {
        assert.equal(isRealInternalUrl("", AUTHORIZED), false);
        assert.equal(isRealInternalUrl("   ", AUTHORIZED), false);
      },
    },
    {
      name: "rechaza una URL malformada sin lanzar excepcion",
      fn: () => {
        assert.doesNotThrow(() => isRealInternalUrl("https://", AUTHORIZED));
        assert.equal(isRealInternalUrl("https://", AUTHORIZED), false);
      },
    },
    {
      name: "rechaza texto instructivo/descriptivo que no es ni path ni URL (tal como aparece a veces en proposedChanges)",
      fn: () => {
        assert.equal(isRealInternalUrl("Enlazar hacia la landing general de taquillas Zentry", AUTHORIZED), false);
      },
    },
    {
      name: "resolucion por defecto (sin authorizedHosts explicito) usa el cliente activo y no lanza",
      fn: () => {
        assert.doesNotThrow(() => isRealInternalUrl("/algo"));
        assert.equal(isRealInternalUrl("/algo"), true);
      },
    },
  ];
}
