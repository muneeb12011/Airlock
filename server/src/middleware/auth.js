import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { query } from "../db.js";
import { clientIp } from "../lib/ip.js";
import { getSettings } from "../lib/settings.js";
import { audit } from "../lib/audit.js";
import { sha256 } from "../lib/crypto.js";

export const USER_COLUMNS = `id, name, email, role, is_active, token_version, must_change_password,
  totp_enabled, last_login_at, created_at, title, bio, timezone, avatar_file_id, notify_prefs`;

export function signSession(user) {
  return jwt.sign({ id: user.id, tv: user.token_version, typ: "session" }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Loads and validates the user behind a session token. Returns null if the
// token is bad, the account is gone or disabled, or the session was revoked
// (token_version bumped by a password change or "sign out everywhere").
export async function userFromToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.typ !== "session") return null;
    const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [payload.id]);
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) return null;
    return user;
  } catch {
    return null;
  }
}

// Personal API tokens ("alk_…") for scripts, CI and integrations.
export const API_TOKEN_PREFIX = "alk_";
async function userFromApiToken(raw, req) {
  const { rows } = await query(
    `SELECT t.id AS token_id, t.scope, t.last_used_at, u.${USER_COLUMNS.split(",").map((c) => c.trim()).join(", u.")}
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [sha256(raw)]
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  // Record use at most once a minute per token.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at) > 60_000) {
    query(`UPDATE api_tokens SET last_used_at = now(), last_used_ip = $2 WHERE id = $1`, [row.token_id, clientIp(req)]).catch(() => {});
  }
  const { token_id, scope, last_used_at, ...user } = row;
  return { user, token: { id: token_id, scope } };
}

export async function setupState(user) {
  const settings = await getSettings();
  return {
    must_change_password: user.must_change_password,
    must_enroll_2fa: Boolean(settings.enforce_2fa) && !user.totp_enabled,
  };
}

export function avatarUrl(fileId) {
  return fileId ? `/avatars/${fileId}` : null;
}

export function publicUser(u, setup) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title || null,
    bio: u.bio || null,
    timezone: u.timezone || null,
    avatar_url: avatarUrl(u.avatar_file_id),
    notify_prefs: u.notify_prefs,
    totp_enabled: u.totp_enabled,
    last_login_at: u.last_login_at,
    created_at: u.created_at,
    ...(setup || {}),
  };
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Not signed in" });
  const raw = header.slice(7).trim();

  if (raw.startsWith(API_TOKEN_PREFIX)) {
    const found = await userFromApiToken(raw, req);
    if (!found) return res.status(401).json({ error: "API token is invalid, expired or revoked." });
    if (found.token.scope === "read" && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return res.status(403).json({ error: "This API token is read-only." });
    }
    req.user = found.user;
    req.apiToken = found.token;
    return next();
  }

  const user = await userFromToken(raw);
  if (!user) return res.status(401).json({ error: "Your session has ended. Please sign in again." });
  req.user = user;
  next();
}

// Some endpoints (changing passwords, 2FA, minting tokens) need a real
// interactive session, never an API token.
export function requireSession(req, res, next) {
  if (req.apiToken) return res.status(403).json({ error: "This action needs a signed-in session, not an API token." });
  next();
}

// Blocks everything except account-setup endpoints until a forced password
// change or mandatory 2FA enrolment is done.
export async function requireSetupComplete(req, res, next) {
  const state = await setupState(req.user);
  if (state.must_change_password || state.must_enroll_2fa) {
    return res.status(403).json({
      error: state.must_change_password
        ? "Set a new password before continuing."
        : "Two-factor authentication is required. Set it up to continue.",
      code: "SETUP_REQUIRED",
      ...state,
    });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access only" });
  next();
}

export function requireLead(req, res, next) {
  if (!["admin", "manager"].includes(req.user?.role)) return res.status(403).json({ error: "Only admins and managers can do this." });
  next();
}

// Admin data-export routes only work from approved networks. Relies on the
// `trust proxy` hop count in app.js so X-Forwarded-For can't be spoofed.
export async function restrictToAllowedIPs(req, res, next) {
  const allow = config.adminAllowedIps;
  if (allow.length === 0) return next();
  const ip = clientIp(req);
  if (!allow.includes(ip)) {
    await audit(req, "security.ip_blocked", { meta: { path: req.originalUrl, ip } });
    return res.status(403).json({
      error: `Downloads are restricted to approved networks. Your IP (${ip}) is not on the list.`,
      code: "IP_NOT_ALLOWED",
    });
  }
  next();
}
