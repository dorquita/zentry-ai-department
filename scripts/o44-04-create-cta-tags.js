require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

const MEASUREMENT_ID = "G-Z9TSGVENQY";

const EVENTS = [
  { event: "click_presupuesto_personalizado", tagName: "GA4 Event - click_presupuesto_personalizado", triggerName: "click_presupuesto_personalizado" },
  { event: "click_whatsapp_floating", tagName: "GA4 Event - click_whatsapp_floating", triggerName: "click_whatsapp_floating" },
  { event: "sticky_presupuesto_click", tagName: "GA4 Event - sticky_presupuesto_click", triggerName: "sticky_presupuesto_click" },
];

async function main() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN });
  const tagmanager = google.tagmanager({ version: "v2", auth: client });

  const accountId = "6364338615";
  const containerId = process.env.GTM_CONTAINER_ID.trim();
  const parent = `accounts/${accountId}/containers/${containerId}`;

  // 1. Create a dedicated workspace (draft area, does not affect the live site until a version is created AND published)
  const wsRes = await tagmanager.accounts.containers.workspaces.create({
    parent,
    requestBody: {
      name: "O44 - Eventos CTA nuevos (sin publicar, pendiente aprobacion Pau)",
      description:
        "Anade 3 triggers de Evento personalizado + 3 tags GA4 Event para click_presupuesto_personalizado, click_whatsapp_floating y sticky_presupuesto_click. No toca ningun tag/trigger existente. NO PUBLICAR sin confirmacion explicita de Pau. Fase O44.",
    },
  });
  const workspaceId = wsRes.data.workspaceId;
  console.log("workspace created:", workspaceId, "-", wsRes.data.name);

  const wsPath = `${parent}/workspaces/${workspaceId}`;
  const created = { workspaceId, triggers: [], tags: [] };

  // 2. Create the 3 custom event triggers
  for (const ev of EVENTS) {
    const trRes = await tagmanager.accounts.containers.workspaces.triggers.create({
      parent: wsPath,
      requestBody: {
        name: ev.triggerName,
        type: "customEvent",
        customEventFilter: [
          {
            type: "equals",
            parameter: [
              { type: "template", key: "arg0", value: "{{_event}}" },
              { type: "template", key: "arg1", value: ev.event },
            ],
          },
        ],
      },
    });
    console.log("trigger created:", trRes.data.triggerId, "-", trRes.data.name);
    created.triggers.push({ event: ev.event, triggerId: trRes.data.triggerId, name: trRes.data.name });
  }

  // 3. Create the 3 GA4 Event tags, each firing only on its matching trigger
  for (let i = 0; i < EVENTS.length; i++) {
    const ev = EVENTS[i];
    const triggerId = created.triggers[i].triggerId;
    const tagRes = await tagmanager.accounts.containers.workspaces.tags.create({
      parent: wsPath,
      requestBody: {
        name: ev.tagName,
        type: "gaawe",
        parameter: [
          { type: "boolean", key: "sendEcommerceData", value: "false" },
          { type: "template", key: "eventName", value: ev.event },
          { type: "template", key: "measurementIdOverride", value: MEASUREMENT_ID },
        ],
        firingTriggerId: [triggerId],
        tagFiringOption: "oncePerEvent",
      },
    });
    console.log("tag created:", tagRes.data.tagId, "-", tagRes.data.name);
    created.tags.push({ event: ev.event, tagId: tagRes.data.tagId, name: tagRes.data.name, firingTriggerId: triggerId });
  }

  fs.writeFileSync("/opt/zentry-ai-department/reports/o44-gtm-cta-tags-created.json", JSON.stringify({ createdAt: new Date().toISOString(), workspaceId, ...created }, null, 2));

  console.log("\n=== DONE (workspace left UNPUBLISHED, pending Pau's review) ===");
  console.log("workspaceId:", workspaceId);
}
main().catch((e) => console.error("FATAL", e.message));
