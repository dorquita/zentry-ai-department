import { ProductionDispatchInputs } from "../approvals/api-contract";
import { Env, hasEnv, readEnv } from "./env";

/**
 * DISPARO DEL WORKFLOW DE PRODUCCION (`workflow_dispatch`).
 *
 * Es la UNICA forma que tiene el Worker de provocar una escritura en
 * produccion, y a proposito es indirecta: el Worker no conoce WordPress,
 * no tiene sus credenciales y no sabe que hay que escribir. Lo unico que
 * hace es decir "la aprobacion X esta encolada" y quien publica de verdad
 * es el workflow de GitHub Actions con los executors deterministas de
 * siempre, que releen staging, comprueban la version aprobada, hacen
 * snapshot y saben revertir.
 *
 * Por eso el UNICO dato que viaja es el `approvalId`
 * (`ProductionDispatchInputs`): ni especificaciones, ni contenido, ni
 * valores a escribir. Quien recibe el dispatch relee el registro
 * autoritativo. Si alguien consiguiera falsificar un dispatch, lo maximo
 * que lograria es pedir que se publique algo que YA tiene una aprobacion
 * humana registrada en D1 y que sigue casando con staging.
 *
 * `workflow_dispatch` responde 204 SIN cuerpo: la API no devuelve el id
 * del run. Por eso `githubRunId` es `null` aqui -- lo rellena el propio
 * workflow cuando arranca, via `POST /api/approvals/:id/transition`. No
 * se inventa.
 */

const GITHUB_API_BASE = "https://api.github.com";

/** GitHub rechaza peticiones sin User-Agent. Identifica al Worker, no lleva ningun dato. */
const USER_AGENT = "zentry-approvals-worker";

export type GithubDispatchResult =
  | { ok: true; githubRunId: string | null; detail: string }
  /** Fail-closed: si no se pudo disparar, NO se ha publicado nada y quien llama debe dejarlo dicho. */
  | { ok: false; githubRunId: null; detail: string };

/** PUERTO que consume `webhook.ts`. Depender de la interfaz es lo que permite testear el fallo de dispatch sin red. */
export interface GithubDispatchPort {
  dispatch(inputs: ProductionDispatchInputs): Promise<GithubDispatchResult>;
}

export interface GithubDispatchConfig {
  token: string;
  /** `owner/repo`. */
  repository: string;
  /** Fichero del workflow, p.ej. `department-production-apply.yml`. */
  workflow: string;
  /** Rama sobre la que lanzarlo. */
  ref: string;
}

/** Lee la configuracion del Env. No valida aqui: `createGithubDispatcher` es quien falla cerrado. */
export function readGithubDispatchConfig(env: Env): GithubDispatchConfig {
  return {
    token: readEnv(env, "GITHUB_DISPATCH_TOKEN"),
    repository: readEnv(env, "GITHUB_REPOSITORY"),
    workflow: readEnv(env, "GITHUB_PRODUCTION_WORKFLOW"),
    ref: readEnv(env, "GITHUB_WORKFLOW_REF"),
  };
}

/** `true` si el Worker tiene TODO lo necesario para disparar. Sin esto no se encola nada. */
export function isGithubDispatchConfigured(env: Env): boolean {
  return hasEnv(env, ["GITHUB_DISPATCH_TOKEN", "GITHUB_REPOSITORY", "GITHUB_PRODUCTION_WORKFLOW", "GITHUB_WORKFLOW_REF"]);
}

/** Tapa el PAT si apareciera literalmente dentro de un texto de error. */
export function redactDispatchToken(raw: string, token: string): string {
  let safe = String(raw ?? "");
  if (token && token.length >= 6) safe = safe.split(token).join("[REDACTED]");
  return safe.length > 400 ? `${safe.slice(0, 400)}...[truncado]` : safe;
}

export function createGithubDispatcher(config: GithubDispatchConfig): GithubDispatchPort {
  return {
    async dispatch(inputs: ProductionDispatchInputs): Promise<GithubDispatchResult> {
      const missing = !config.token || !config.repository || !config.workflow || !config.ref;
      if (missing) {
        // No se dice CUAL falta: el mensaje puede acabar en Telegram.
        return { ok: false, githubRunId: null, detail: "El disparo del workflow de produccion no esta configurado en este Worker. No se ha encolado nada." };
      }

      const url = `${GITHUB_API_BASE}/repos/${config.repository}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": USER_AGENT,
            "content-type": "application/json",
          },
          // `inputs` de workflow_dispatch solo admite strings.
          body: JSON.stringify({ ref: config.ref, inputs: { approvalId: inputs.approvalId } }),
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, githubRunId: null, detail: `Fallo de red disparando el workflow de produccion: ${redactDispatchToken(raw, config.token)}` };
      }

      // 204 No Content es el exito documentado de este endpoint.
      if (response.status !== 204) {
        let body = "";
        try {
          body = await response.text();
        } catch {
          body = "";
        }
        return {
          ok: false,
          githubRunId: null,
          detail: `GitHub respondio ${response.status} al disparar el workflow de produccion: ${redactDispatchToken(body, config.token)}`,
        };
      }

      return { ok: true, githubRunId: null, detail: "Workflow de produccion disparado. El id del run lo anota el propio workflow al arrancar." };
    },
  };
}
