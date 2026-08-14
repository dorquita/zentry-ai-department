require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

async function main() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN });
  const tagmanager = google.tagmanager({ version: "v2", auth: client });

  const containerId = process.env.GTM_CONTAINER_ID.trim();

  const accountsResp = await tagmanager.accounts.list({});
  const accounts = accountsResp.data.account || [];
  console.log("accounts:", accounts.map((a) => a.accountId + ":" + a.name));

  let accountId = null;
  let container = null;
  for (const acc of accounts) {
    const containersResp = await tagmanager.accounts.containers.list({ parent: `accounts/${acc.accountId}` });
    const match = (containersResp.data.container || []).find((c) => c.containerId === containerId);
    if (match) { accountId = acc.accountId; container = match; break; }
  }
  if (!container) { console.log("container not found"); return; }
  console.log("found container:", container.name, container.publicId);

  const livePath = `accounts/${accountId}/containers/${containerId}/versions:live`;
  const live = await tagmanager.accounts.containers.versions.live({ parent: `accounts/${accountId}/containers/${containerId}` });
  const liveData = live.data;

  console.log("\nlive version:", liveData.name, "id", liveData.containerVersionId);
  console.log("tags:", (liveData.tag || []).length, "triggers:", (liveData.trigger || []).length, "variables:", (liveData.variable || []).length);

  fs.writeFileSync("/opt/zentry-ai-department/reports/o43-gtm-live-version-full.json", JSON.stringify(liveData, null, 2));
  console.log("Full live version saved to reports/o43-gtm-live-version-full.json");

  console.log("\n=== TAGS ===");
  (liveData.tag || []).forEach((t) => console.log(t.tagId, "|", t.name, "| type:", t.type, "| paused:", !!t.paused, "| firingTriggerId:", t.firingTriggerId));

  console.log("\n=== TRIGGERS relevant to whatsapp/quote ===");
  (liveData.trigger || []).forEach((tr) => {
    if (/whatsapp|quote|contact|presupuesto/i.test(tr.name)) {
      console.log(JSON.stringify(tr, null, 2));
    }
  });
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
