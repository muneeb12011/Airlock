import crypto from "crypto";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const env = process.env;
const isProd = env.NODE_ENV === "production";

function list(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const WEAK_SECRETS = new Set([
  "",
  "secret",
  "changeme",
  "change_this_to_a_long_random_string",
]);

const jwtSecret = env.JWT_SECRET || "";
if (WEAK_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
  if (isProd) {
    console.error(
      "FATAL: JWT_SECRET is missing or weak. Set a random value of at least 32 characters.\n" +
        "Generate one with:  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
    process.exit(1);
  } else {
    console.warn("[config] JWT_SECRET is weak — fine for local dev, never for production.");
  }
}

if (!env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}

// Key used to encrypt 2FA secrets at rest. Falls back to a key derived from
// JWT_SECRET so a single-secret setup still works, but a separate key means
// leaking one secret doesn't expose the other.
const dataKey = env.DATA_ENCRYPTION_KEY
  ? crypto.createHash("sha256").update(env.DATA_ENCRYPTION_KEY).digest()
  : crypto.createHash("sha256").update(`airlock-data:${jwtSecret}`).digest();

const DEFAULT_BLOCKED = [
  "exe", "dll", "scr", "com", "pif", "bat", "cmd", "msi", "msp", "ps1", "psm1",
  "vbs", "vbe", "wsf", "wsh", "hta", "lnk", "cpl", "reg", "jar", "apk", "iso",
  "img", "vhd", "vhdx", "xll", "appx", "msix", "scf", "url",
];

export const config = {
  isProd,
  port: Number(env.PORT) || 5000,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL
    ? env.DATABASE_SSL !== "false"
    : !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL),
  jwtSecret,
  jwtExpiresIn: env.JWT_EXPIRES_IN || "8h",
  dataKey,
  frontendOrigins: list(env.FRONTEND_URL),
  // Number of reverse proxies in front of the API. 0 = connected directly.
  // Render/Railway/Fly/HF Spaces = 1. NEVER set "true": it lets clients
  // spoof X-Forwarded-For and walk past the admin IP allowlist.
  trustProxy: Number.isFinite(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY) : 0,
  adminAllowedIps: list(env.ADMIN_ALLOWED_IPS),
  uploadDir: path.resolve(env.UPLOAD_DIR || "uploads"),
  maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 100) * 1024 * 1024,
  blockedExtensions: new Set(env.BLOCKED_EXTENSIONS ? list(env.BLOCKED_EXTENSIONS.toLowerCase()) : DEFAULT_BLOCKED),
  lockout: {
    maxAttempts: Number(env.LOCKOUT_MAX_ATTEMPTS) || 5,
    minutes: Number(env.LOCKOUT_MINUTES) || 15,
  },
  appName: env.APP_NAME || "Airlock",
};
