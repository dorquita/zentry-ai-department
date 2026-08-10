import * as assert from "node:assert/strict";
import * as path from "path";
import {
  resolveClientId,
  loadClientConfig,
  validateClientConfig,
  listClientIds,
  ClientConfigError,
  DEFAULT_CLIENT_ID,
  ClientConfig,
  resolveClientEnvVarName,
  resolveClientEnvVar,
  resolveClientSecret,
  resolveClientServiceCredentials,
} from "../src/core/client-config";
import { resolveClientPaths } from "../src/core/client-paths";

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

function validZentryLikeConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  const base = loadClientConfig("zentry", { strict: true });
  return { ...base, ...overrides };
}

export function runClientConfigTests(): TestCase[] {
  return [
    {
      name: "resolveClientId sin --client ni CLIENT_ID cae a zentry",
      fn: () => {
        withEnv({ CLIENT_ID: undefined }, () => {
          assert.equal(resolveClientId([]), DEFAULT_CLIENT_ID);
        });
      },
    },
    {
      name: "resolveClientId prioriza --client sobre CLIENT_ID env",
      fn: () => {
        withEnv({ CLIENT_ID: "demo" }, () => {
          assert.equal(resolveClientId(["--client", "zentry"]), "zentry");
        });
      },
    },
    {
      name: "resolveClientId usa CLIENT_ID env si no hay --client",
      fn: () => {
        withEnv({ CLIENT_ID: "demo" }, () => {
          assert.equal(resolveClientId([]), "demo");
        });
      },
    },
    {
      name: "listClientIds incluye zentry y demo",
      fn: () => {
        const ids = listClientIds();
        assert.ok(ids.includes("zentry"), "deberia incluir zentry");
        assert.ok(ids.includes("demo"), "deberia incluir demo");
      },
    },
    {
      name: "loadClientConfig('zentry') carga sin lanzar y valida sin problemas",
      fn: () => {
        const config = loadClientConfig("zentry", { strict: true });
        assert.equal(config.clientId, "zentry");
        assert.equal(config.isSandbox, false);
        const issues = validateClientConfig(config);
        assert.deepEqual(issues, [], `zentry no deberia tener problemas de validacion: ${JSON.stringify(issues)}`);
      },
    },
    {
      name: "loadClientConfig('demo') carga sin lanzar y valida sin problemas",
      fn: () => {
        const config = loadClientConfig("demo", { strict: true });
        assert.equal(config.clientId, "demo");
        assert.equal(config.isSandbox, true);
        assert.deepEqual(config.allowedServices, []);
        const issues = validateClientConfig(config);
        assert.deepEqual(issues, [], `demo no deberia tener problemas de validacion: ${JSON.stringify(issues)}`);
      },
    },
    {
      name: "loadClientConfig no estricto con cliente inexistente cae a zentry sin lanzar",
      fn: () => {
        const config = loadClientConfig("cliente-que-no-existe-o16-test");
        assert.equal(config.clientId, DEFAULT_CLIENT_ID);
      },
    },
    {
      name: "loadClientConfig estricto con cliente inexistente lanza ClientConfigError",
      fn: () => {
        assert.throws(() => loadClientConfig("cliente-que-no-existe-o16-test", { strict: true }), ClientConfigError);
      },
    },
    {
      name: "validateClientConfig detecta productionUrl invalida",
      fn: () => {
        const config = validZentryLikeConfig({ productionUrl: "no-es-una-url" });
        const issues = validateClientConfig(config);
        assert.ok(issues.some((i) => i.field === "productionUrl"));
      },
    },
    {
      name: "validateClientConfig detecta servicio desconocido en allowedServices",
      fn: () => {
        const config = validZentryLikeConfig({ allowedServices: ["servicio_inventado" as unknown as ClientConfig["allowedServices"][number]] });
        const issues = validateClientConfig(config);
        assert.ok(issues.some((i) => i.field === "allowedServices" && i.message.includes("servicio_inventado")));
      },
    },
    {
      name: "validateClientConfig rechaza sandbox apuntando a un dominio real",
      fn: () => {
        const config = validZentryLikeConfig({ isSandbox: true, productionUrl: "https://un-dominio-real-cualquiera.com" });
        const issues = validateClientConfig(config);
        assert.ok(issues.some((i) => i.field === "productionUrl" && i.message.includes("sandbox")));
      },
    },
    {
      name: "validateClientConfig rechaza sandbox con allowedServices no vacio",
      fn: () => {
        const config = validZentryLikeConfig({ isSandbox: true, allowedServices: ["seo_watcher"] });
        const issues = validateClientConfig(config);
        assert.ok(issues.some((i) => i.field === "allowedServices" && i.message.includes("sandbox")));
      },
    },
    {
      name: "validateClientConfig detecta un secreto literal filtrado en el JSON",
      fn: () => {
        const config = validZentryLikeConfig({
          notificationSettings: {
            ...validZentryLikeConfig().notificationSettings,
            // clave sensible (no termina en EnvVar) con un valor real, no un placeholder
            // @ts-expect-error -- inyeccion deliberada para el test
            apiSecretKey: "sk-live-abcdefghijklmnopqrstuvwxyz1234567890",
          },
        });
        const issues = validateClientConfig(config);
        assert.ok(
          issues.some((i) => i.message.toLowerCase().includes("secreto")),
          `deberia detectar el secreto filtrado: ${JSON.stringify(issues)}`
        );
      },
    },
    {
      name: "validateClientConfig NO marca como secreto un *EnvVar bien nombrado",
      fn: () => {
        const config = validZentryLikeConfig();
        const issues = validateClientConfig(config);
        assert.ok(!issues.some((i) => i.message.toLowerCase().includes("secreto")));
      },
    },
    {
      name: "resolveClientPaths('zentry') usa las carpetas legacy de la raiz, no clients/zentry/data",
      fn: () => {
        const paths = resolveClientPaths("zentry");
        assert.equal(paths.usesLegacyRootPaths, true);
        assert.ok(paths.dataDir.endsWith(`${path.sep}data`));
        assert.ok(!paths.dataDir.includes(path.join("clients", "zentry")));
      },
    },
    {
      name: "resolveClientPaths('demo') usa carpetas propias bajo clients/demo",
      fn: () => {
        const paths = resolveClientPaths("demo");
        assert.equal(paths.usesLegacyRootPaths, false);
        assert.ok(paths.dataDir.includes(path.join("clients", "demo", "data")));
        assert.ok(paths.reportsDir.includes(path.join("clients", "demo", "reports")));
        assert.ok(paths.logsDir.includes(path.join("clients", "demo", "logs")));
      },
    },
    {
      name: "resolveClientEnvVarName construye <CLIENTID>_<KEY> en mayusculas",
      fn: () => {
        assert.equal(resolveClientEnvVarName("acme", "GA4_PROPERTY_ID"), "ACME_GA4_PROPERTY_ID");
        assert.equal(resolveClientEnvVarName("Demo", "SMTP_PASS"), "DEMO_SMTP_PASS");
      },
    },
    {
      name: "resolveClientEnvVar prefiere la variable prefijada si existe",
      fn: () => {
        withEnv({ ACME_GA4_PROPERTY_ID: "999", GA4_PROPERTY_ID: "111" }, () => {
          assert.equal(resolveClientEnvVar("acme", "GA4_PROPERTY_ID"), "999");
        });
      },
    },
    {
      name: "resolveClientEnvVar cae a la variable legacy SOLO para zentry",
      fn: () => {
        withEnv({ ZENTRY_GA4_PROPERTY_ID: undefined, GA4_PROPERTY_ID: "544190531" }, () => {
          assert.equal(resolveClientEnvVar("zentry", "GA4_PROPERTY_ID"), "544190531");
        });
      },
    },
    {
      name: "resolveClientEnvVar NO tiene fallback legacy para clientes distintos de zentry",
      fn: () => {
        withEnv({ ACME_GA4_PROPERTY_ID: undefined, GA4_PROPERTY_ID: "544190531" }, () => {
          assert.equal(resolveClientEnvVar("acme", "GA4_PROPERTY_ID"), undefined);
        });
      },
    },
    {
      name: "resolveClientSecret lanza con el nombre PREFIJADO si falta, nunca un valor",
      fn: () => {
        withEnv({ ACME_SMTP_PASS: undefined, SMTP_PASS: undefined }, () => {
          assert.throws(() => resolveClientSecret("acme", "SMTP_PASS"), /ACME_SMTP_PASS/);
        });
      },
    },
    {
      name: "resolveClientServiceCredentials detecta credenciales completas",
      fn: () => {
        withEnv(
          {
            ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_ID: "x",
            ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: "x",
            ACME_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN: "x",
            ACME_GA4_PROPERTY_ID: "123",
          },
          () => {
            const status = resolveClientServiceCredentials("acme", "ga4");
            assert.equal(status.complete, true);
            assert.deepEqual(status.missing, []);
          }
        );
      },
    },
    {
      name: "resolveClientServiceCredentials devuelve nombres PREFIJADOS de lo que falta, nunca valores",
      fn: () => {
        withEnv(
          {
            ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_ID: undefined,
            GOOGLE_ANALYTICS_OAUTH_CLIENT_ID: undefined,
            ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: undefined,
            GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET: undefined,
            ACME_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN: undefined,
            GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN: undefined,
            ACME_GA4_PROPERTY_ID: undefined,
            GA4_PROPERTY_ID: undefined,
          },
          () => {
            const status = resolveClientServiceCredentials("acme", "ga4");
            assert.equal(status.complete, false);
            assert.deepEqual(
              [...status.missing].sort(),
              [
                "ACME_GA4_PROPERTY_ID",
                "ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_ID",
                "ACME_GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET",
                "ACME_GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN",
              ].sort()
            );
          }
        );
      },
    },
  ];
}
