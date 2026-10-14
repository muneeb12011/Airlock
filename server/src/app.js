import crypto from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./lib/http.js";
import { cachedSettings, getSettings } from "./lib/settings.js";
import { authenticate, requireSetupComplete } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import userRoutes from "./routes/users.js";
import teamRoutes from "./routes/teams.js";
import projectRoutes from "./routes/projects.js";
import taskRoutes from "./routes/tasks.js";
import messageRoutes from "./routes/messages.js";
import notificationRoutes from "./routes/notifications.js";
import searchRoutes from "./routes/search.js";
import reportRoutes from "./routes/reports.js";
import adminRoutes from "./routes/admin.js";
import integrationRoutes from "./routes/integrations.js";
import avatarRoutes from "./routes/avatars.js";

export const VERSION = "3.0.0";
const normalize = (o) => String(o || "").trim().replace(/\/$/, "").toLowerCase();

// Allowed browser origins = FRONTEND_URL (env) + origins admins add under
// Settings → Workspace. Settings are cached, so this stays fast.
export function allowedOrigins() {
  return new Set([...config.frontendOrigins, ...(cachedSettings().extra_origins || [])].map(normalize));
}

export function corsOrigin(origin, cb) {
  // Same-origin, curl and server-to-server requests have no Origin header.
  if (!origin) return cb(null, true);
  const allowed = allowedOrigins();
  if (allowed.size === 0) return cb(null, !config.isProd);
  cb(null, allowed.has(normalize(origin)));
}

const app = express();

// Explicit hop count, never `true` — see TRUST_PROXY in .env.example.
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");

// Request id + one structured log line per request in production.
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"]?.toString().slice(0, 64) || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (!config.isProd && process.env.LOG_REQUESTS !== "true") return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        id: req.id,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Math.round(ms),
        user: req.user?.id ?? null,
        token: req.apiToken ? true : undefined,
      })
    );
  });
  next();
});

// Refresh the settings cache in the background so CORS sees new origins.
app.use((req, _res, next) => {
  getSettings().catch(() => {});
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], imgSrc: ["'self'"] } },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: corsOrigin,
    exposedHeaders: ["Content-Disposition", "X-File-SHA256", "X-Request-Id"],
    maxAge: 600,
  })
);
app.use(express.json({ limit: "200kb" }));

app.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT) || 1500,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
    message: { error: "Too many requests. Slow down and try again in a few minutes." },
  })
);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", version: VERSION });
  } catch {
    res.status(503).json({ ok: false, db: "down", version: VERSION });
  }
});

app.use("/auth", authRoutes);
app.use("/avatars", avatarRoutes);

// Everything else requires a valid session (or API token) with setup done.
const guard = [authenticate, requireSetupComplete];
app.use("/me", authenticate, meRoutes); // setup screens use parts of /me
app.use("/users", guard, userRoutes);
app.use("/teams", guard, teamRoutes);
app.use("/projects", guard, projectRoutes);
app.use("/tasks", guard, taskRoutes);
app.use("/messages", guard, messageRoutes);
app.use("/notifications", guard, notificationRoutes);
app.use("/search", guard, searchRoutes);
app.use("/reports", guard, reportRoutes);
app.use("/admin", guard, adminRoutes);
app.use("/integrations", guard, integrationRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  console.error(`[error] ${req.id} ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on our side. Try again in a moment.", request_id: req.id });
});

export default app;
