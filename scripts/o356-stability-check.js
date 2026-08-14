require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function check(n) {
  const r = await fetch(base + "/?o356stab=" + Date.now() + "_" + n, { headers: { "Cache-Control": "no-cache" } });
  const cacheHdr = r.headers.get("x-litespeed-cache") || r.headers.get("x-cache") || "(none)";
  const html = await r.text();
  const idx = html.indexOf('"page_links"');
  const snippet = html.slice(idx, idx + 220);
  console.log("run", n, "| cache:", cacheHdr, "|", snippet.replace(/\s+/g, ' '));
}

async function main() {
  for (let i = 1; i <= 6; i++) {
    await check(i);
    await new Promise(res => setTimeout(res, 800));
  }
}
main().catch(e => console.error("ERR", e.message));
