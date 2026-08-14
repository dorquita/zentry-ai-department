require("dotenv").config();
const base = process.env.WORDPRESS_PRODUCTION_BASE_URL;

async function main() {
  const r = await fetch(base + "/wp-cron.php?doing_wp_cron=" + (Date.now()/1000));
  console.log("wp-cron.php status:", r.status);
}
main().catch(e => console.error("ERR", e.message));
