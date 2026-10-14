import http from "http";
import { config } from "./config.js";
import app from "./app.js";
import { initSocket } from "./socket.js";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";
import { getSettings } from "./lib/settings.js";
import { startScheduler, stopScheduler } from "./lib/scheduler.js";
import { emailEnabled } from "./lib/mailer.js";

async function main() {
  // Apply pending migrations on boot so a deploy can never run new code
  // against an old schema. Set AUTO_MIGRATE=false to manage this yourself.
  if (process.env.AUTO_MIGRATE !== "false") await runMigrations();

  await getSettings(); // warm the cache (CORS reads extra origins from it)
  startScheduler();

  const server = http.createServer(app);
  initSocket(server);
  server.listen(config.port, () => {
    console.log(`[airlock] API listening on :${config.port} (${config.isProd ? "production" : "development"})`);
    if (config.isProd && config.frontendOrigins.length === 0) {
      console.warn("[airlock] FRONTEND_URL is empty — browsers on other origins will be refused by CORS.");
    }
    if (!emailEnabled()) console.warn("[airlock] Email is off (no SMTP_URL) — invites and resets use one-time passwords.");
    if (config.adminAllowedIps.length === 0) {
      console.warn("[airlock] ADMIN_ALLOWED_IPS is empty — admin exports work from any network.");
    }
  });

  const shutdown = (signal) => {
    console.log(`[airlock] ${signal} received, shutting down`);
    stopScheduler();
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => console.error("[airlock] unhandled rejection:", err));

main().catch((err) => {
  console.error("[airlock] failed to start:", err.message);
  process.exit(1);
});
