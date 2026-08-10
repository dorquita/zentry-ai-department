import * as assert from "node:assert/strict";
import { classifyNovamiraAbility, isNovamiraAbilityAllowed } from "../src/core/novamira-guard";

export interface TestCase {
  name: string;
  fn: () => void;
}

/** Guarda y restaura las env vars relevantes alrededor de cada test que las toca. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

export function runNovamiraGuardTests(): TestCase[] {
  return [
    // --- Bloqueadas permanentemente (dangerous_forbidden), en cualquier entorno/flag ---
    {
      name: "execute-php siempre bloqueada, incluso con staging+flag+aprobacion",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/execute-php", { approvalGranted: true });
          assert.equal(result.allowed, false);
          assert.equal(result.risk, "dangerous_forbidden");
        });
      },
    },
    {
      name: "run-wp-cli siempre bloqueada",
      fn: () => {
        const result = isNovamiraAbilityAllowed("novamira/run-wp-cli");
        assert.equal(result.allowed, false);
        assert.equal(result.risk, "dangerous_forbidden");
      },
    },
    {
      name: "write-file / edit-file / delete-file siempre bloqueadas",
      fn: () => {
        for (const ability of ["novamira/write-file", "novamira/edit-file", "novamira/delete-file"]) {
          const result = isNovamiraAbilityAllowed(ability);
          assert.equal(result.allowed, false, `${ability} deberia estar bloqueada`);
          assert.equal(result.risk, "dangerous_forbidden");
        }
      },
    },
    {
      name: "create-admin-access-link siempre bloqueada",
      fn: () => {
        const result = isNovamiraAbilityAllowed("novamira/create-admin-access-link");
        assert.equal(result.allowed, false);
        assert.equal(result.risk, "dangerous_forbidden");
      },
    },
    {
      name: "create-upload-link / disable-file / enable-file / skill-write / skill-edit / skill-delete tambien bloqueadas (mismo riesgo que las explicitas)",
      fn: () => {
        const abilities = [
          "novamira/create-upload-link",
          "novamira/disable-file",
          "novamira/enable-file",
          "novamira/skill-write",
          "novamira/skill-edit",
          "novamira/skill-delete",
        ];
        for (const ability of abilities) {
          assert.equal(classifyNovamiraAbility(ability), "dangerous_forbidden", ability);
          assert.equal(isNovamiraAbilityAllowed(ability).allowed, false, ability);
        }
      },
    },

    // --- manual_only: bloqueadas igual que dangerous_forbidden desde el guard ---
    {
      name: "read-file / list-directory / get-wp-cli-job son manual_only y el guard las bloquea igualmente",
      fn: () => {
        for (const ability of ["novamira/read-file", "novamira/list-directory", "novamira/get-wp-cli-job"]) {
          assert.equal(classifyNovamiraAbility(ability), "manual_only", ability);
          assert.equal(isNovamiraAbilityAllowed(ability).allowed, false, ability);
        }
      },
    },

    // --- Lectura permitida (safe_read) ---
    {
      name: "gutenberg-get-content permitida (lectura segura)",
      fn: () => {
        const result = isNovamiraAbilityAllowed("novamira/gutenberg-get-content");
        assert.equal(result.allowed, true);
        assert.equal(result.risk, "safe_read");
      },
    },
    {
      name: "lectura Yoast (get-seo-scores / get-readability-scores) permitida",
      fn: () => {
        assert.equal(isNovamiraAbilityAllowed("yoast-seo/get-seo-scores").allowed, true);
        assert.equal(isNovamiraAbilityAllowed("yoast-seo/get-readability-scores").allowed, true);
      },
    },
    {
      name: "lectura de estructura/inspeccion (discover-abilities, get-pending-batch, list-pending-batches) permitida",
      fn: () => {
        assert.equal(isNovamiraAbilityAllowed("mcp-adapter/discover-abilities").allowed, true);
        assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-get-pending-batch").allowed, true);
        assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-list-pending-batches").allowed, true);
      },
    },
    {
      name: "safe_read permitida incluso en produccion (la lectura nunca depende del entorno)",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "production" }, () => {
          assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-get-content").allowed, true);
        });
      },
    },

    // --- Escritura bloqueada en produccion, siempre ---
    {
      name: "escritura de contenido bloqueada en produccion, incluso con flag+aprobacion activos",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "production", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/gutenberg-write-content", { approvalGranted: true });
          assert.equal(result.allowed, false);
          assert.match(result.reason, /produccion/i);
        });
      },
    },

    // --- Escritura en staging bloqueada si el flag esta a false/ausente ---
    {
      name: "escritura de contenido en staging bloqueada si NOVAMIRA_STAGING_WRITES_ENABLED no esta activo",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: undefined }, () => {
          const result = isNovamiraAbilityAllowed("novamira/gutenberg-create-pending-batch");
          assert.equal(result.allowed, false);
        });
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "false" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/gutenberg-create-pending-batch");
          assert.equal(result.allowed, false);
        });
      },
    },
    {
      name: "escritura en staging con flag activo pero sin aprobacion sigue bloqueada si la ability la requiere",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/gutenberg-write-content");
          assert.equal(result.allowed, false);
          assert.match(result.reason, /aprobacion/i);
        });
      },
    },
    {
      name: "escritura en staging permitida cuando se cumplen las 4 condiciones (staging + flag + allowlist + aprobacion)",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/gutenberg-write-content", { approvalGranted: true });
          assert.equal(result.allowed, true);
        });
      },
    },
    {
      name: "escritura en staging que NO requiere aprobacion (crear/anadir/borrar lote en cola) permitida solo con staging+flag",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-create-pending-batch").allowed, true);
          assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-add-pending-change").allowed, true);
          assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-delete-pending-batch").allowed, true);
          assert.equal(isNovamiraAbilityAllowed("novamira/gutenberg-delete-pending-change").allowed, true);
        });
      },
    },

    // --- Fail-closed: ability desconocida (no en el JSON) se bloquea por defecto ---
    {
      name: "ability desconocida (no presente en el allowlist) se bloquea por defecto, fail-closed",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          const result = isNovamiraAbilityAllowed("novamira/some-brand-new-future-ability");
          assert.equal(result.allowed, false);
          assert.equal(result.risk, "dangerous_forbidden");
        });
      },
    },
  ];
}
