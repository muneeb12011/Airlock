import express from "express";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db.js";
import {
  authenticate,
  requireSession,
  signSession,
  setupState,
  publicUser,
  USER_COLUMNS,
} from "../middleware/auth.js";
import { parse, HttpError, badRequest, unauthorized, conflict } from "../lib/http.js";
import { checkPassword, burnTime, hashPassword, passwordProblem } from "../lib/passwords.js";
import { encrypt, decrypt, sha256 } from "../lib/crypto.js";
import {
  generateSecret,
  otpauthUrl,
  verifyTotp,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "../lib/totp.js";
import { clientIp } from "../lib/ip.js";
import { audit } from "../lib/audit.js";
import { notify, notifyAdmins } from "../lib/notify.js";
import { getSettings, publicSettings } from "../lib/settings.js";
import { emailEnabled, sendMail, appUrl } from "../lib/mailer.js";
import { emitEvent } from "../lib/webhooks.js";
import { createAuthToken, consumeAuthToken, peekAuthToken } from "../lib/authTokens.js";
import { disconnectUser } from "../lib/realtime.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts from this network. Wait 15 minutes and try again." },
});

const MFA_TTL = "5m";

async function logLogin(req, { userId = null, email = null, success, reason = null, newIp = false }) {
  await query(
    `INSERT INTO login_logs (user_id, ip_address, user_agent, success, reason, email_attempted, new_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [userId, clientIp(req), String(req.headers["user-agent"] || "").slice(0, 500), success, reason, email, newIp]
  );
}

// Counts a failed attempt; locks the account after too many in a row.
async function recordFailure(req, user, reason) {
  const { rows } = await query(
    `UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts`,
    [user.id]
  );
  await logLogin(req, { userId: user.id, email: user.email, success: false, reason });
  if (rows[0].failed_attempts >= config.lockout.maxAttempts) {
    await query(
      `UPDATE users SET failed_attempts = 0, locked_until = now() + ($2 || ' minutes')::interval WHERE id = $1`,
      [user.id, String(config.lockout.minutes)]
    );
    await audit(req, "auth.account_locked", {
      actor: user,
      targetType: "user",
      targetId: user.id,
      meta: { reason, minutes: config.lockout.minutes },
    });
    notify(user.id, {
      type: "security",
      title: "Your account was temporarily locked",
      body: `${config.lockout.maxAttempts} failed sign-in attempts from ${clientIp(req)}. If this wasn't you, change your password.`,
      link: "/account",
    });
    emitEvent("security.account_locked", { user: user.name });
    notifyAdmins(
      {
        type: "security",
        title: `${user.name}'s account was locked`,
        body: `${config.lockout.maxAttempts} failed sign-ins from ${clientIp(req)}.`,
        link: "/admin/security",
      },
      { except: user.id }
    );
  }
}

function lockedMessage(user) {
  const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
  return `Too many failed attempts. This account is locked for ${mins} more minute${mins === 1 ? "" : "s"}.`;
}

async function completeLogin(req, user, method) {
  const ip = clientIp(req);
  const prior = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE ip_address = $2)::int AS same_ip
     FROM login_logs WHERE user_id = $1 AND success`,
    [user.id, ip]
  );
  const newIp = prior.rows[0].total > 0 && prior.rows[0].same_ip === 0;

  const { rows } = await query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now()
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [user.id]
  );
  const fresh = rows[0];
  await logLogin(req, { userId: user.id, email: user.email, success: true, reason: method, newIp });
  await audit(req, "auth.login", { actor: fresh, targetType: "user", targetId: fresh.id, meta: { method, new_ip: newIp } });

  if (newIp) {
    notify(user.id, {
      type: "security",
      title: "New sign-in from an unfamiliar network",
      body: `IP ${ip} · ${String(req.headers["user-agent"] || "unknown device").slice(0, 90)}. If this wasn't you, change your password and sign out everywhere.`,
      link: "/account",
    });
  }

  const setup = await setupState(fresh);
  return { token: signSession(fresh), user: publicUser(fresh, setup) };
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(150),
  password: z.string().min(1, "Password is required").max(200),
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, password_hash, failed_attempts, locked_until FROM users WHERE lower(email) = $1`,
    [email]
  );
  const user = rows[0];

  if (!user) {
    await burnTime(password);
    await logLogin(req, { email, success: false, reason: "unknown_email" });
    throw unauthorized("Wrong email or password.");
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logLogin(req, { userId: user.id, email, success: false, reason: "locked" });
    throw new HttpError(423, lockedMessage(user), { code: "LOCKED" });
  }
  if (!(await checkPassword(password, user.password_hash))) {
    await recordFailure(req, user, "bad_password");
    throw unauthorized("Wrong email or password.");
  }
  if (!user.is_active) {
    await logLogin(req, { userId: user.id, email, success: false, reason: "disabled" });
    throw new HttpError(403, "This account has been disabled. Contact your admin.");
  }

  if (user.totp_enabled) {
    const mfaToken = jwt.sign({ id: user.id, tv: user.token_version, typ: "mfa" }, config.jwtSecret, {
      expiresIn: MFA_TTL,
    });
    return res.json({ mfa_required: true, mfa_token: mfaToken });
  }

  res.json(await completeLogin(req, user, "password"));
});

const verifySchema = z.object({
  mfa_token: z.string().min(1),
  code: z.string().trim().max(20).optional(),
  recovery_code: z.string().trim().max(40).optional(),
});

router.post("/login/verify", loginLimiter, async (req, res) => {
  const body = parse(verifySchema, req.body);
  let payload;
  try {
    payload = jwt.verify(body.mfa_token, config.jwtSecret);
  } catch {
    throw unauthorized("Your sign-in took too long. Start again.", { code: "MFA_EXPIRED" });
  }
  if (payload.typ !== "mfa") throw unauthorized("Invalid sign-in step.");

  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, totp_secret_enc, totp_last_step, recovery_codes, locked_until FROM users WHERE id = $1`,
    [payload.id]
  );
  const user = rows[0];
  if (!user || !user.is_active || user.token_version !== payload.tv || !user.totp_enabled) {
    throw unauthorized("Start the sign-in again.", { code: "MFA_EXPIRED" });
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(423, lockedMessage(user), { code: "LOCKED" });
  }

  if (body.recovery_code) {
    const hash = sha256(normalizeRecoveryCode(body.recovery_code));
    const codes = user.recovery_codes || [];
    if (!codes.includes(hash)) {
      await recordFailure(req, user, "bad_recovery_code");
      throw unauthorized("That recovery code isn't valid or was already used.");
    }
    const remaining = codes.filter((c) => c !== hash);
    await query(`UPDATE users SET recovery_codes = $2 WHERE id = $1`, [user.id, JSON.stringify(remaining)]);
    await audit(req, "auth.recovery_code_used", { actor: user, targetType: "user", targetId: user.id, meta: { remaining: remaining.length } });
    notify(user.id, {
      type: "security",
      title: "A recovery code was used to sign in",
      body: `${remaining.length} recovery code${remaining.length === 1 ? "" : "s"} left. Generate new ones from your account page if you're running low.`,
      link: "/account",
    });
    return res.json(await completeLogin(req, user, "recovery_code"));
  }

  const step = verifyTotp(decrypt(user.totp_secret_enc), body.code, { lastStep: user.totp_last_step });
  if (step === null) {
    await recordFailure(req, user, "bad_2fa_code");
    throw unauthorized("That code didn't work. Codes change every 30 seconds — use the newest one.");
  }
  await query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [user.id, step]);
  res.json(await completeLogin(req, user, "password+2fa"));
});

// ---------- public: workspace info for the sign-in screen ----------
router.get("/config", async (_req, res) => {
  const s = await getSettings();
  res.json({ workspace_name: s.workspace_name, email_enabled: emailEnabled() });
});

// ---------- forgot password / invites ----------
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many reset requests. Try again later." },
});

router.post("/forgot", forgotLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email") }), req.body);
  // Same answer whether or not the account exists, so this can't be used to
  // discover who has an account.
  res.json({ ok: true, email_enabled: emailEnabled() });
  if (!emailEnabled()) return;
  const { rows } = await query(`SELECT id, name, email, is_active FROM users WHERE lower(email) = $1`, [email]);
  const user = rows[0];
  if (!user || !user.is_active) return;
  const token = await createAuthToken(user.id, "reset", 60);
  await audit(req, "auth.reset_requested", { actor: user, targetType: "user", targetId: user.id });
  sendMail({
    to: user.email,
    subject: "Reset your password",
    heading: `Reset your password, ${user.name.split(" ")[0]}`,
    text: `Someone (hopefully you) asked to reset your password from IP ${clientIp(req)}. The link works once and expires in 1 hour. If you didn't ask for this, ignore this email — your password won't change.`,
    cta: "Choose a new password",
    ctaUrl: appUrl(`/reset?token=${token}`),
  });
});

router.get("/token-info", async (req, res) => {
  const info = await peekAuthToken(String(req.query.token || ""));
  if (!info) throw badRequest("This link is invalid or has expired. Ask for a new one.", { code: "TOKEN_INVALID" });
  res.json({ purpose: info.purpose, name: info.name, email: info.email });
});

router.post("/reset", forgotLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }), req.body);
  const info = await peekAuthToken(body.token);
  if (!info) throw badRequest("This link is invalid or has expired. Ask for a new one.", { code: "TOKEN_INVALID" });
  const problem = await passwordProblem(body.password, info);
  if (problem) throw badRequest(problem, { field: "password" });
  const used = await consumeAuthToken(body.token);
  if (!used) throw badRequest("This link was already used.", { code: "TOKEN_INVALID" });
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = false, failed_attempts = 0, locked_until = NULL,
       token_version = token_version + 1, updated_at = now() WHERE id = $1`,
    [info.user_id, await hashPassword(body.password)]
  );
  disconnectUser(info.user_id);
  await audit(req, info.purpose === "invite" ? "auth.invite_accepted" : "auth.password_reset_by_email", {
    actor: { id: info.user_id, name: info.name },
    targetType: "user",
    targetId: info.user_id,
  });
  res.json({ ok: true, email: info.email });
});

// ---------- everything below requires a session ----------
router.use(authenticate);

router.get("/me", async (req, res) => {
  const settings = await getSettings();
  const setup = await setupState(req.user);
  const { rows } = await query(`SELECT jsonb_array_length(recovery_codes) AS n FROM users WHERE id = $1`, [req.user.id]);
  res.json({
    user: { ...publicUser(req.user, setup), recovery_codes_left: rows[0].n },
    settings: publicSettings(settings),
  });
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, "Enter your current password"),
  new_password: z.string().min(1).max(200),
});

router.post("/password", requireSession, async (req, res) => {
  const body = parse(changePasswordSchema, req.body);
  const { rows } = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await checkPassword(body.current_password, rows[0].password_hash))) {
    throw badRequest("Your current password is wrong.", { field: "current_password" });
  }
  if (body.current_password === body.new_password) throw badRequest("Choose a password you haven't used here.");
  const problem = await passwordProblem(body.new_password, req.user);
  if (problem) throw badRequest(problem, { field: "new_password" });

  const updated = await query(
    `UPDATE users SET password_hash = $2, must_change_password = false,
       token_version = token_version + 1, updated_at = now()
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.user.id, await hashPassword(body.new_password)]
  );
  const fresh = updated.rows[0];
  await audit(req, "auth.password_changed", { targetType: "user", targetId: fresh.id });
  disconnectUser(fresh.id); // other devices are signed out
  res.json({ token: signSession(fresh), user: publicUser(fresh, await setupState(fresh)) });
});

router.post("/logout-all", requireSession, async (req, res) => {
  await query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [req.user.id]);
  await audit(req, "auth.logout_all", { targetType: "user", targetId: req.user.id });
  disconnectUser(req.user.id);
  res.json({ ok: true });
});

router.get("/activity", async (req, res) => {
  const { rows } = await query(
    `SELECT id, ip_address, user_agent, success, reason, new_ip, login_at
     FROM login_logs WHERE user_id = $1 ORDER BY login_at DESC LIMIT 25`,
    [req.user.id]
  );
  res.json(rows);
});

// ---------- two-factor ----------
router.post("/2fa/setup", requireSession, async (req, res) => {
  if (req.user.totp_enabled) throw conflict("Two-factor is already on. Turn it off first to re-enrol.");
  const secret = generateSecret();
  await query(`UPDATE users SET totp_secret_enc = $2, totp_last_step = NULL WHERE id = $1`, [req.user.id, encrypt(secret)]);
  const url = otpauthUrl({ secret, account: req.user.email, issuer: config.appName });
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  res.json({ secret, otpauth_url: url, qr });
});

const codeSchema = z.object({ code: z.string().trim().min(6).max(10) });

router.post("/2fa/enable", requireSession, async (req, res) => {
  const { code } = parse(codeSchema, req.body);
  const { rows } = await query(`SELECT totp_secret_enc, totp_enabled FROM users WHERE id = $1`, [req.user.id]);
  if (rows[0].totp_enabled) throw conflict("Two-factor is already on.");
  if (!rows[0].totp_secret_enc) throw badRequest("Start setup first.");
  const step = verifyTotp(decrypt(rows[0].totp_secret_enc), code);
  if (step === null) throw badRequest("That code didn't match. Check your phone's clock is set automatically, then try the newest code.");

  const { codes, hashes } = generateRecoveryCodes();
  const updated = await query(
    `UPDATE users SET totp_enabled = true, totp_last_step = $2, recovery_codes = $3,
       token_version = token_version + 1
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.user.id, step, JSON.stringify(hashes)]
  );
  const fresh = updated.rows[0];
  await audit(req, "auth.2fa_enabled", { targetType: "user", targetId: fresh.id });
  disconnectUser(fresh.id);
  res.json({
    recovery_codes: codes,
    token: signSession(fresh),
    user: publicUser(fresh, await setupState(fresh)),
  });
});

const passwordCodeSchema = z.object({
  password: z.string().min(1, "Enter your password"),
  code: z.string().trim().min(6).max(10),
});

async function verifyPasswordAndCode(userId, { password, code }) {
  const { rows } = await query(`SELECT password_hash, totp_secret_enc, totp_last_step FROM users WHERE id = $1`, [userId]);
  if (!(await checkPassword(password, rows[0].password_hash))) throw badRequest("Wrong password.", { field: "password" });
  const step = verifyTotp(decrypt(rows[0].totp_secret_enc), code, { lastStep: rows[0].totp_last_step });
  if (step === null) throw badRequest("That code didn't match.", { field: "code" });
  await query(`UPDATE users SET totp_last_step = $2 WHERE id = $1`, [userId, step]);
}

router.post("/2fa/disable", requireSession, async (req, res) => {
  if (!req.user.totp_enabled) throw badRequest("Two-factor isn't on.");
  await verifyPasswordAndCode(req.user.id, parse(passwordCodeSchema, req.body));
  const updated = await query(
    `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL,
       recovery_codes = '[]'::jsonb, token_version = token_version + 1
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.user.id]
  );
  const fresh = updated.rows[0];
  await audit(req, "auth.2fa_disabled", { targetType: "user", targetId: fresh.id });
  notifyAdmins(
    { type: "security", title: `${fresh.name} turned off two-factor`, link: "/admin/team" },
    { except: fresh.id }
  );
  disconnectUser(fresh.id);
  res.json({ token: signSession(fresh), user: publicUser(fresh, await setupState(fresh)) });
});

router.post("/2fa/recovery-codes", requireSession, async (req, res) => {
  if (!req.user.totp_enabled) throw badRequest("Two-factor isn't on.");
  await verifyPasswordAndCode(req.user.id, parse(passwordCodeSchema, req.body));
  const { codes, hashes } = generateRecoveryCodes();
  await query(`UPDATE users SET recovery_codes = $2 WHERE id = $1`, [req.user.id, JSON.stringify(hashes)]);
  await audit(req, "auth.recovery_codes_regenerated", { targetType: "user", targetId: req.user.id });
  res.json({ recovery_codes: codes });
});

export default router;
