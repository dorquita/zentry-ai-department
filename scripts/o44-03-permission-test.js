require("dotenv").config();
const { google } = require("googleapis");

async function main() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN });
  const tagmanager = google.tagmanager({ version: "v2", auth: client });

  const accountId = "6364338615";
  const containerId = process.env.GTM_CONTAINER_ID.trim();
  const parent = `accounts/${accountId}/containers/${containerId}`;

  const results = { workspaceCreate: null, versionCreate: null, cleanupWorkspace: null, cleanupVersion: null };

  // 1. Try creating a workspace (no tags/triggers added to it -- pure permission probe)
  let workspace;
  try {
    const res = await tagmanager.accounts.containers.workspaces.create({
      parent,
      requestBody: {
        name: "O44.0 - Prueba de permisos (temporal, se borra sola)",
        description: "Creado por auditoria O44.0 solo para confirmar permiso de escritura. Sin tags ni triggers. Se elimina automaticamente al final del mismo script.",
      },
    });
    workspace = res.data;
    results.workspaceCreate = { ok: true, workspaceId: workspace.workspaceId };
    console.log("workspace create: OK, id", workspace.workspaceId);
  } catch (err) {
    results.workspaceCreate = { ok: false, error: err.message };
    console.log("workspace create: FAILED -", err.message);
  }

  // 2. If workspace created, try creating a version from it (no changes in the workspace -> no-op version, never published)
  if (workspace) {
    try {
      const wsPath = `${parent}/workspaces/${workspace.workspaceId}`;
      const verRes = await tagmanager.accounts.containers.workspaces.create_version({
        path: wsPath,
        requestBody: { name: "O44.0 - version de prueba (sin cambios)", notes: "Prueba de permiso, no se publica." },
      });
      results.versionCreate = { ok: true, containerVersionId: verRes.data.containerVersion ? verRes.data.containerVersion.containerVersionId : null, compilerError: verRes.data.compilerError, syncStatus: verRes.data.syncStatus };
      console.log("version create: OK,", JSON.stringify(results.versionCreate));
    } catch (err) {
      results.versionCreate = { ok: false, error: err.message };
      console.log("version create: FAILED -", err.message);
    }
  }

  // 3. Cleanup: delete the test version itself (versions survive workspace deletion, would otherwise linger in version history forever)
  if (results.versionCreate && results.versionCreate.ok && results.versionCreate.containerVersionId) {
    try {
      await tagmanager.accounts.containers.versions.delete({ path: `${parent}/versions/${results.versionCreate.containerVersionId}` });
      results.cleanupVersion = { ok: true };
      console.log("cleanup version: OK (deleted)");
    } catch (err) {
      results.cleanupVersion = { ok: false, error: err.message };
      console.log("cleanup version: FAILED -", err.message);
    }
  }

  // 4. Cleanup: delete the test workspace (do NOT touch the created version's published state -- it was never published)
  if (workspace) {
    try {
      await tagmanager.accounts.containers.workspaces.delete({ path: `${parent}/workspaces/${workspace.workspaceId}` });
      results.cleanupWorkspace = { ok: true };
      console.log("cleanup workspace: OK (deleted)");
    } catch (err) {
      results.cleanupWorkspace = { ok: false, error: err.message };
      console.log("cleanup workspace: FAILED -", err.message);
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
}
main().catch((e) => console.error("FATAL", e.message));
