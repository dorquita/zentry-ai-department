require("dotenv").config();
const { google } = require("googleapis");

async function main() {
  const client = new google.auth.OAuth2(process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_ID, process.env.GOOGLE_ANALYTICS_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_ANALYTICS_OAUTH_REFRESH_TOKEN });

  let accessToken;
  try {
    const res = await client.getAccessToken();
    accessToken = res.token;
    console.log("refresh -> access token: OK (token obtained, not printed)");
  } catch (err) {
    console.log("refresh -> access token: FAILED");
    console.log("error:", err.message);
    return;
  }

  // Check granted scopes via tokeninfo (does not expose the token itself in output)
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + accessToken);
  const info = await r.json();
  console.log("\n=== TOKEN SCOPE INFO (no secrets) ===");
  console.log("scope:", info.scope);
  console.log("expires_in:", info.expires_in);
  console.log("aud (client id suffix only):", info.aud ? "..." + info.aud.slice(-15) : null);
}
main().catch((e) => console.error("FATAL", e.message));
