require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function check(n) {
  const r = await fetch(base + "/?o356fresh=" + Date.now() + "_" + n);
  console.log("cache header:", r.headers.get("x-litespeed-cache") || r.headers.get("x-cache") || "(none)");
  const html = await r.text();
  const idx = html.indexOf('"page_links"');
  console.log("run", n, ":", html.slice(idx, idx + 300));
  console.log("");
}

async function main() {
  for (let i = 1; i <= 3; i++) {
    await check(i);
    await new Promise(res => setTimeout(res, 1000));
  }
}
main().catch(e => console.error("ERR", e.message));
