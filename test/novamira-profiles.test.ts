import * as assert from "node:assert/strict";
import { classifyNovamiraAbility, isNovamiraAbilityAllowed } from "../src/core/novamira-guard";
import {
  assertAbilityAllowedForProfile,
  isAbilityAllowedForProfile,
  NOVAMIRA_PROFILES,
  NovamiraProfile,
  READ_ONLY_EMPLOYEES,
  resolveProfileForEmployee,
  riskCeilingForProfile,
} from "../src/core/novamira-profiles";

export interface TestCase {
  name: string;
  fn: () => void;
}

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

/** Abilities que NUNCA puede desbloquear nada, con ningun perfil. */
const FORBIDDEN_ABILITIES = [
  "novamira/execute-php",
  "novamira/run-wp-cli",
  "novamira/write-file",
  "novamira/edit-file",
  "novamira/delete-file",
  "novamira/create-admin-access-link",
  "novamira/create-upload-link",
  "novamira/disable-file",
  "novamira/enable-file",
  "novamira/skill-write",
  "novamira/skill-edit",
  "novamira/skill-delete",
  "novamira/read-file",
  "novamira/list-directory",
  "novamira/get-wp-cli-job",
];

const STAGING_WRITE_ABILITIES = [
  "novamira/gutenberg-write-content",
  "novamira/gutenberg-create-pending-batch",
  "novamira/gutenberg-add-pending-change",
  "novamira/gutenberg-enable-batch-finalization",
  "novamira/gutenberg-delete-pending-batch",
  "novamira/gutenberg-delete-pending-change",
];

const READ_ABILITIES = [
  "mcp-adapter/discover-abilities",
  "novamira/gutenberg-get-content",
  "novamira/gutenberg-get-pending-batch",
  "novamira/gutenberg-list-pending-batches",
  "novamira/gutenberg-get-finalizer-runtime",
  "novamira/gutenberg-get-finalization-url",
  "novamira/skill-get",
  "yoast-seo/get-seo-scores",
  "yoast-seo/get-readability-scores",
];

/** Entorno en el que el guard SI permitiria una escritura de staging. */
const STAGING_WRITES_ON = { WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: "true" };

export function runNovamiraProfilesTests(): TestCase[] {
  return [
    // --- INVARIANTE CENTRAL: un perfil solo estrecha, nunca amplia ---
    {
      name: "INVARIANTE: ningun perfil, presente o futuro, incluye dangerous_forbidden ni manual_only en su techo de riesgo",
      fn: () => {
        for (const profile of NOVAMIRA_PROFILES) {
          const ceiling = riskCeilingForProfile(profile);
          assert.ok(!ceiling.includes("dangerous_forbidden"), `el perfil ${profile} no puede incluir dangerous_forbidden`);
          assert.ok(!ceiling.includes("manual_only"), `el perfil ${profile} no puede incluir manual_only`);
          assert.ok(ceiling.length > 0, `el perfil ${profile} declara un techo vacio`);
        }
      },
    },
    {
      name: "INVARIANTE: si el guard dice NO, ningun perfil puede convertirlo en SI",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          for (const ability of [...FORBIDDEN_ABILITIES, "novamira/ability-que-no-existe"]) {
            assert.equal(isNovamiraAbilityAllowed(ability, { approvalGranted: true }).allowed, false, `precondicion: el guard bloquea ${ability}`);
            for (const profile of NOVAMIRA_PROFILES) {
              const decision = isAbilityAllowedForProfile(profile, ability, { approvalGranted: true });
              assert.equal(decision.allowed, false, `${ability} no puede permitirse con el perfil ${profile}`);
            }
          }
        });
      },
    },
    {
      name: "Una ability desconocida se bloquea con cualquier perfil (fail-closed, tambien aqui)",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          for (const profile of NOVAMIRA_PROFILES) {
            const decision = isAbilityAllowedForProfile(profile, "novamira/inventada-manana", { approvalGranted: true });
            assert.equal(decision.allowed, false);
            assert.equal(decision.risk, "dangerous_forbidden");
          }
        });
      },
    },
    {
      name: "Un perfil inexistente no permite nada, ni siquiera lectura segura",
      fn: () => {
        const decision = isAbilityAllowedForProfile("perfil_inventado" as NovamiraProfile, "mcp-adapter/discover-abilities");
        assert.equal(decision.allowed, false);
        assert.ok(decision.reason.includes("desconocido"));
      },
    },

    // --- SPECIALISTS_READ_ONLY ---
    {
      name: "Los especialistas pueden usar TODAS las abilities de lectura del allowlist",
      fn: () => {
        for (const ability of READ_ABILITIES) {
          assert.equal(classifyNovamiraAbility(ability), "safe_read", `precondicion: ${ability} es safe_read`);
          const decision = isAbilityAllowedForProfile("specialists_read_only", ability);
          assert.equal(decision.allowed, true, `${ability} deberia permitirse a un especialista`);
        }
      },
    },
    {
      name: "Un especialista NUNCA puede escribir, ni con staging + flag + aprobacion humana concedida",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          for (const ability of STAGING_WRITE_ABILITIES) {
            const decision = isAbilityAllowedForProfile("specialists_read_only", ability, { approvalGranted: true });
            assert.equal(decision.allowed, false, `${ability} no puede permitirse a un especialista`);
            assert.ok(decision.reason.includes("specialists_read_only"), "el motivo debe nombrar el perfil que lo impide");
          }
        });
      },
    },
    {
      name: "TODOS los empleados Claude conocidos resuelven a solo lectura -- incluido web-engineer, que especifica pero no aplica",
      fn: () => {
        for (const employee of READ_ONLY_EMPLOYEES) {
          assert.equal(resolveProfileForEmployee(employee), "specialists_read_only", employee);
        }
        assert.equal(resolveProfileForEmployee("web-engineer"), "specialists_read_only", "web-engineer produce un ChangePlan; la escritura la hace la capa de apply");
        assert.equal(resolveProfileForEmployee("empleado-nuevo-de-manana"), "specialists_read_only", "un empleado desconocido cae en el perfil mas estrecho");
      },
    },

    // --- WEB_ENGINEER_STAGING_WRITE ---
    {
      name: "La capa de apply SI puede escribir en staging cuando los interruptores estan puestos",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          // Sin requiresApproval en el allowlist: basta con entorno + flag.
          for (const ability of ["novamira/gutenberg-create-pending-batch", "novamira/gutenberg-add-pending-change", "novamira/gutenberg-delete-pending-batch", "novamira/gutenberg-delete-pending-change"]) {
            const decision = isAbilityAllowedForProfile("web_engineer_staging_write", ability);
            assert.equal(decision.allowed, true, `${ability} deberia permitirse a la capa de apply`);
          }
        });
      },
    },
    {
      name: "Las abilities con requiresApproval siguen exigiendo aprobacion humana AUNQUE el perfil sea el de escritura",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          for (const ability of ["novamira/gutenberg-write-content", "novamira/gutenberg-enable-batch-finalization"]) {
            assert.equal(isAbilityAllowedForProfile("web_engineer_staging_write", ability).allowed, false, `${ability} sin aprobacion`);
            assert.equal(isAbilityAllowedForProfile("web_engineer_staging_write", ability, { approvalGranted: true }).allowed, true, `${ability} con aprobacion`);
          }
        });
      },
    },
    {
      name: "Sin NOVAMIRA_STAGING_WRITES_ENABLED no se escribe, por mucho perfil de escritura que haya",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "staging", NOVAMIRA_STAGING_WRITES_ENABLED: undefined }, () => {
          const decision = isAbilityAllowedForProfile("web_engineer_staging_write", "novamira/gutenberg-add-pending-change");
          assert.equal(decision.allowed, false);
          assert.ok(decision.reason.includes("NOVAMIRA_STAGING_WRITES_ENABLED"), "el motivo debe nombrar el interruptor exacto que falta");
        });
      },
    },

    // --- PRODUCCION ---
    {
      name: "PRODUCCION BLOQUEADA: con WORDPRESS_ENV=production ningun perfil escribe, ni con flag y aprobacion",
      fn: () => {
        withEnv({ WORDPRESS_ENV: "production", NOVAMIRA_STAGING_WRITES_ENABLED: "true" }, () => {
          for (const profile of NOVAMIRA_PROFILES) {
            for (const ability of STAGING_WRITE_ABILITIES) {
              const decision = isAbilityAllowedForProfile(profile, ability, { approvalGranted: true });
              assert.equal(decision.allowed, false, `${ability} con perfil ${profile} en produccion`);
            }
          }
        });
      },
    },
    {
      name: "El perfil production_write existe para poder nombrarlo, pero hoy NO concede ninguna escritura en ningun entorno",
      fn: () => {
        assert.deepEqual(riskCeilingForProfile("production_write"), ["safe_read"]);
        withEnv({ ...STAGING_WRITES_ON }, () => {
          for (const ability of STAGING_WRITE_ABILITIES) {
            assert.equal(isAbilityAllowedForProfile("production_write", ability, { approvalGranted: true }).allowed, false, ability);
          }
        });
      },
    },

    // --- Version que lanza ---
    {
      name: "assertAbilityAllowedForProfile lanza con el perfil y el motivo exactos, y no lanza cuando esta permitido",
      fn: () => {
        withEnv({ ...STAGING_WRITES_ON }, () => {
          assert.throws(
            () => assertAbilityAllowedForProfile("specialists_read_only", "novamira/gutenberg-write-content", { approvalGranted: true }),
            /specialists_read_only/
          );
          assert.throws(() => assertAbilityAllowedForProfile("web_engineer_staging_write", "novamira/execute-php", { approvalGranted: true }), /dangerous_forbidden/);
          assert.doesNotThrow(() => assertAbilityAllowedForProfile("specialists_read_only", "novamira/gutenberg-get-content"));
        });
      },
    },
  ];
}
