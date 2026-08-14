require("dotenv").config();
const { google } = require("googleapis");

async function main() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN });
  const tagmanager = google.tagmanager({ version: "v2", auth: client });

  const accountId = "6364338615";
  const containerId = process.env.GTM_CONTAINER_ID.trim();
  const parent = `accounts/${accountId}/containers/${containerId}`;

  const ws = await tagmanager.accounts.containers.workspaces.list({ parent });
  console.log("workspaces:", JSON.stringify((ws.data.workspace || []).map((w) => ({ id: w.workspaceId, name: w.name, description: w.description })), null, 2));
}
main().catch((e) => console.error("FATAL", e.message));
