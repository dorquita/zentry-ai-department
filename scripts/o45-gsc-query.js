require("dotenv").config();
const fs = require("fs");
const { google } = require("googleapis");

async function main() {
  const client = new google.auth.OAuth2(process.env.GSC_OAUTH_CLIENT_ID, process.env.GSC_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GSC_OAUTH_REFRESH_TOKEN });

  let accessToken;
  try {
    const res = await client.getAccessToken();
    accessToken = res.token;
    console.log("access token: OK");
  } catch (err) {
    console.log("access token FAILED:", err.message);
    return;
  }

  const siteUrl = "sc-domain:zentrylockers.com";
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC data lag
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 180);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const body = {
    startDate: fmt(startDate),
    endDate: fmt(endDate),
    dimensions: ["query", "page"],
    rowLimit: 25000,
    dataState: "all",
  };

  console.log("Query range:", body.startDate, "to", body.endDate);

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    console.log("API ERROR", r.status, text.slice(0, 1000));
    return;
  }
  const data = JSON.parse(text);
  const rows = data.rows || [];
  console.log("total rows (query+page combos):", rows.length);

  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-gsc-raw.json", JSON.stringify(rows, null, 2));

  // also a query-only rollup (aggregate across pages) for easier top-query analysis
  const byQuery = {};
  for (const row of rows) {
    const q = row.keys[0];
    const page = row.keys[1];
    if (!byQuery[q]) byQuery[q] = { query: q, clicks: 0, impressions: 0, positions: [], pages: {} };
    byQuery[q].clicks += row.clicks;
    byQuery[q].impressions += row.impressions;
    byQuery[q].positions.push(row.position);
    byQuery[q].pages[page] = (byQuery[q].pages[page] || 0) + row.clicks + row.impressions * 0.01;
  }
  const rollup = Object.values(byQuery).map((q) => {
    const topPage = Object.entries(q.pages).sort((a, b) => b[1] - a[1])[0];
    return {
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: q.impressions ? ((q.clicks / q.impressions) * 100).toFixed(2) + "%" : "0%",
      avgPosition: (q.positions.reduce((a, b) => a + b, 0) / q.positions.length).toFixed(1),
      topPage: topPage ? topPage[0] : null,
    };
  });
  rollup.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);

  fs.writeFileSync("/opt/zentry-ai-department/reports/o45-gsc-rollup.json", JSON.stringify(rollup, null, 2));
  console.log("total unique queries:", rollup.length);
  console.log("\n=== TOP 100 BY IMPRESSIONS ===");
  rollup.slice(0, 100).forEach((q) => {
    console.log(`${q.query} | clicks:${q.clicks} | impr:${q.impressions} | ctr:${q.ctr} | pos:${q.avgPosition} | page:${q.topPage}`);
  });
}
main().catch((e) => console.error("FATAL", e.message, e.stack));
