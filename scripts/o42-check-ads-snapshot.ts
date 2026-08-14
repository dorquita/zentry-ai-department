import { hasGoogleAdsCredentials, getGoogleAdsSnapshot } from "../src/adapters/google-ads";

async function main() {
  const creds = hasGoogleAdsCredentials();
  console.log("credentials ok:", creds.ok, "missing:", creds.missing);
  if (!creds.ok) return;

  const snapshot = await getGoogleAdsSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
}
main().catch((e) => console.error("ERR", e.message, e.stack));
