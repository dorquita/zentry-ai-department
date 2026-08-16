import { google, tagmanager_v2 } from "googleapis";
import { logger } from "../core/logger";
import { recordCredentialFailure, recordCredentialSuccess } from "../core/credential-health";
import {
  loadActiveClientAnalyticsConfig,
  resolveActiveClientId,
  resolveClientSecret,
  resolveClientServiceCredentials,
} from "../core/client-config";

/**
 * REAL adapter para Google Tag Manager — SOLO LECTURA. Unicamente llama a
 * metodos `list`/`get`/`live` de la API v2 de Tag Manager. Este fichero
 * NUNCA importa ni llama a `accounts.containers.versions.publish` (ni
 * ningun otro metodo `create`/`update`/`delete`) — es fisicamente
 * imposible que este adaptador publique un contenedor o modifique un
 * tag/trigger/variable.
 *
 * Fase O11 — Analytics Watcher pasa a leer GTM real cuando estas
 * credenciales existen en `.env` (comparte credenciales OAuth con GA4,
 * ver docs/analytics-readonly.md: el mismo cliente OAuth necesita el
 * scope de GA4 Y el de GTM a la vez).
 */

const TAGMANAGER_READONLY_SCOPE = "https://www.googleapis.com/auth/tagmanager.readonly";
const MAX_ACCOUNT_PAGES = 5;

/**
 * Fase O16.2: gate client-aware (via `resolveClientServiceCredentials`,
 * que ya comprueba `<CLIENTID>_<var>` con fallback legacy solo para
 * "zentry") — sigue mirando SOLO variables de entorno, nunca
 * `clients/<id>/analytics.json` (que no contiene secretos).
 */
export function hasGtmCredentials(clientId: string = resolveActiveClientId()): { ok: boolean; missing: string[] } {
  const status = resolveClientServiceCredentials(clientId, "gtm");
  return { ok: status.complete, missing: status.missing };
}

/** Fase O16.1/O16.2: prefiere `clients/<id>/analytics.json`, luego `<CLIENTID>_GTM_CONTAINER_ID`, luego `.env` legacy. */
function resolveContainerId(): string {
  return loadActiveClientAnalyticsConfig().gtmContainerId ?? resolveClientSecret(resolveActiveClientId(), "GTM_CONTAINER_ID");
}

/** Fase O16.1/O16.2: idem con `GTM_WORKSPACE_ID`. */
function resolveWorkspaceId(): string {
  return loadActiveClientAnalyticsConfig().gtmWorkspaceId ?? resolveClientSecret(resolveActiveClientId(), "GTM_WORKSPACE_ID");
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(
    /((?:access_token|refresh_token|client_secret|api[_-]?key|private_key|authorization|bearer)\s*[:=]?\s*)["']?[A-Za-z0-9\-_./+=]{8,}["']?/gi,
    "$1[REDACTED]"
  );
  return stripped.length > 500 ? stripped.slice(0, 500) + "...[truncated]" : stripped;
}

function buildAuthClient() {
  const activeClientId = resolveActiveClientId();
  const clientId = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_CLIENT_ID");
  const clientSecret = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET");
  const refreshToken = resolveClientSecret(activeClientId, "GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN");
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * El GTM_CONTAINER_ID conocido es el ID interno numerico del contenedor
 * (no el publicId "GTM-XXXXXXX" visible en la UI), pero la API v2 exige
 * conocer tambien el accountId para construir el path
 * `accounts/{accountId}/containers/{containerId}`. Como solo tenemos el
 * containerId, se recorren las cuentas accesibles por las credenciales
 * (normalmente 1) hasta encontrar la que contiene ese containerId.
 */
async function findAccountForContainer(
  tagmanager: tagmanager_v2.Tagmanager,
  containerId: string
): Promise<{ accountId: string; container: tagmanager_v2.Schema$Container }> {
  let pageToken: string | undefined;
  let page = 0;
  do {
    page += 1;
    const accountsResp = await tagmanager.accounts.list({ pageToken });
    const accounts = accountsResp.data.account ?? [];
    for (const account of accounts) {
      if (!account.accountId) continue;
      const containersResp = await tagmanager.accounts.containers.list({
        parent: `accounts/${account.accountId}`,
      });
      const match = (containersResp.data.container ?? []).find((c) => c.containerId === containerId);
      if (match) {
        return { accountId: account.accountId, container: match };
      }
    }
    pageToken = accountsResp.data.nextPageToken ?? undefined;
  } while (pageToken && page < MAX_ACCOUNT_PAGES);

  throw new Error(
    `No se encontro el contenedor GTM_CONTAINER_ID=${containerId} en ninguna de las cuentas accesibles con estas credenciales.`
  );
}

export interface GtmProbeResult {
  accountId: string;
  containerId: string;
  containerName: string;
  containerPublicId: string;
}

/**
 * Fase O50 — probe MINIMO de solo lectura para verificar desde GitHub
 * Actions que las credenciales de GTM llegan de verdad a la API. Solo
 * `accounts.list` + `accounts.containers.list` (via
 * `findAccountForContainer`) — nada de tags/triggers/variables, y desde
 * luego nada de `publish`/`create`/`update`/`delete`, que no existen en
 * este fichero.
 */
export async function probeGtm(): Promise<GtmProbeResult> {
  const containerId = resolveContainerId().trim();
  const auth = buildAuthClient();
  const tagmanager = google.tagmanager({ version: "v2", auth });

  try {
    const { accountId, container } = await findAccountForContainer(tagmanager, containerId);
    recordCredentialSuccess("gtm");
    return {
      accountId,
      containerId,
      containerName: container.name ?? "",
      containerPublicId: container.publicId ?? "",
    };
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Probe de GTM fallo", { error: safeMessage });
    recordCredentialFailure("gtm", safeMessage);
    throw new Error(`Probe de GTM fallo: ${safeMessage}`);
  }
}

export interface GtmTagSummary {
  tagId: string;
  name: string;
  type: string;
  paused: boolean;
}

export interface GtmTriggerSummary {
  triggerId: string;
  name: string;
  type: string;
}

export interface GtmVariableSummary {
  variableId: string;
  name: string;
  type: string;
}

export interface GtmSnapshot {
  accountId: string;
  containerId: string;
  containerName: string;
  containerPublicId: string;
  workspaceId: string;
  workspaceName: string;
  tagCount: number;
  tags: GtmTagSummary[];
  triggerCount: number;
  triggers: GtmTriggerSummary[];
  variableCount: number;
  variables: GtmVariableSummary[];
  liveVersionName: string | null;
  liveVersionId: string | null;
}

const LIST_PREVIEW_LIMIT = 30;

/**
 * Lee cuenta/contenedor/workspace, tags, triggers, variables y la version
 * live del contenedor. Solo lectura: los unicos metodos llamados son
 * `list`, `get` y `live` — nunca `publish`, `create`, `update` ni
 * `delete`.
 */
export async function getGtmSnapshot(): Promise<GtmSnapshot> {
  const containerId = resolveContainerId().trim();
  const workspaceId = resolveWorkspaceId().trim();

  logger.info("Consultando Google Tag Manager (solo lectura, list/get/live)", { containerId, workspaceId });

  const auth = buildAuthClient();
  const tagmanager = google.tagmanager({ version: "v2", auth });

  try {
    const { accountId, container } = await findAccountForContainer(tagmanager, containerId);
    const containerPath = `accounts/${accountId}/containers/${containerId}`;
    const workspacePath = `${containerPath}/workspaces/${workspaceId}`;

    const [workspaceResp, tagsResp, triggersResp, variablesResp, liveVersionResp] = await Promise.all([
      tagmanager.accounts.containers.workspaces.get({ path: workspacePath }),
      tagmanager.accounts.containers.workspaces.tags.list({ parent: workspacePath }),
      tagmanager.accounts.containers.workspaces.triggers.list({ parent: workspacePath }),
      tagmanager.accounts.containers.workspaces.variables.list({ parent: workspacePath }),
      tagmanager.accounts.containers.versions.live({ parent: containerPath }).catch(() => null),
    ]);

    const tags: GtmTagSummary[] = (tagsResp.data.tag ?? []).map((t) => ({
      tagId: t.tagId ?? "",
      name: t.name ?? "",
      type: t.type ?? "",
      paused: Boolean(t.paused),
    }));
    const triggers: GtmTriggerSummary[] = (triggersResp.data.trigger ?? []).map((t) => ({
      triggerId: t.triggerId ?? "",
      name: t.name ?? "",
      type: t.type ?? "",
    }));
    const variables: GtmVariableSummary[] = (variablesResp.data.variable ?? []).map((v) => ({
      variableId: v.variableId ?? "",
      name: v.name ?? "",
      type: v.type ?? "",
    }));

    logger.info("GTM: lectura completada", {
      tags: tags.length,
      triggers: triggers.length,
      variables: variables.length,
      liveVersionFound: Boolean(liveVersionResp?.data),
    });

    const result = {
      accountId,
      containerId,
      containerName: container.name ?? "",
      containerPublicId: container.publicId ?? "",
      workspaceId,
      workspaceName: workspaceResp.data.name ?? "",
      tagCount: tags.length,
      tags: tags.slice(0, LIST_PREVIEW_LIMIT),
      triggerCount: triggers.length,
      triggers: triggers.slice(0, LIST_PREVIEW_LIMIT),
      variableCount: variables.length,
      variables: variables.slice(0, LIST_PREVIEW_LIMIT),
      liveVersionName: liveVersionResp?.data.name ?? null,
      liveVersionId: liveVersionResp?.data.containerVersionId ?? null,
    };
    recordCredentialSuccess("gtm");
    return result;
  } catch (err) {
    const safeMessage = sanitizeError(err);
    logger.error("Fallo la lectura de GTM", { error: safeMessage });
    recordCredentialFailure("gtm", safeMessage);
    throw new Error(`Lectura de GTM fallo: ${safeMessage}`);
  }
}
