// The signed-in person's own profile, preferences, API tokens and data export.
import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { publicUser, setupState, requireSession, requireSetupComplete, USER_COLUMNS, API_TOKEN_PREFIX } from "../middleware/auth.js";
import { parse, intParam, badRequest, notFound } from "../lib/http.js";
import { shieldUpload, deleteStoredFiles } from "../lib/fileShield.js";
import { sha256 } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";

const router = express.Router();

const TIMEZONES = new Set(Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : []);

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(100).optional(),
  title: z.string().trim().max(100).nullable().optional(),
  bio: z.string().trim().max(600).nullable().optional(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .refine((tz) => !tz || TIMEZONES.size === 0 || TIMEZONES.has(tz) || tz === "UTC", "Unknown time zone")
    .nullable()
    .optional(),
  notify_prefs: z
    .object({
      email_assigned: z.boolean().optional(),
      email_review: z.boolean().optional(),
      email_mention: z.boolean().optional(),
      email_security: z.boolean().optional(),
    })
    .optional(),
});

async function fresh(id) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0];
}

router.get("/", async (req, res) => {
  const teams = await query(
    `SELECT t.id, t.name, t.color, (t.lead_id = $1) AS is_lead FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = $1 ORDER BY t.name`,
    [req.user.id]
  );
  res.json({ user: publicUser(req.user, await setupState(req.user)), teams: teams.rows });
});

router.patch("/", requireSetupComplete, async (req, res) => {
  const body = parse(profileSchema, req.body);
  const sent = new Set(Object.keys(req.body || {}));
  const sets = [];
  const params = [req.user.id];
  for (const k of ["name", "title", "bio", "timezone"]) {
    if (sent.has(k)) {
      params.push(body[k] || null);
      sets.push(`${k} = $${params.length}`);
    }
  }
  if (body.notify_prefs) {
    params.push(JSON.stringify(body.notify_prefs));
    sets.push(`notify_prefs = notify_prefs || $${params.length}::jsonb`);
  }
  if (sent.has("name") && !body.name) throw badRequest("Name can't be empty.");
  if (sets.length) await query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  const user = await fresh(req.user.id);
  res.json({ user: publicUser(user, await setupState(user)) });
});

// Avatar: images only (PNG, JPEG, WebP — never SVG, which can carry script).
router.post("/avatar", requireSetupComplete, shieldUpload("file", "avatar"), async (req, res) => {
  const file = req.shieldedFile;
  if (!file) throw badRequest("Choose an image.");
  const okType = ["png", "jpg", "webp"].includes(file.detected_type) && Number(file.size_bytes) <= 3 * 1024 * 1024;
  if (!okType) {
    await query(`DELETE FROM files WHERE id = $1`, [file.id]);
    await deleteStoredFiles([file]);
    throw badRequest("Use a PNG, JPEG or WebP image under 3 MB.");
  }
  const old = await query(`SELECT f.id, f.storage_key FROM users u JOIN files f ON f.id = u.avatar_file_id WHERE u.id = $1`, [req.user.id]);
  await query(`UPDATE users SET avatar_file_id = $2, updated_at = now() WHERE id = $1`, [req.user.id, file.id]);
  if (old.rows[0]) {
    await query(`DELETE FROM files WHERE id = $1`, [old.rows[0].id]);
    await deleteStoredFiles(old.rows);
  }
  const user = await fresh(req.user.id);
  res.json({ user: publicUser(user, await setupState(user)) });
});

router.delete("/avatar", requireSetupComplete, async (req, res) => {
  const old = await query(`SELECT f.id, f.storage_key FROM users u JOIN files f ON f.id = u.avatar_file_id WHERE u.id = $1`, [req.user.id]);
  await query(`UPDATE users SET avatar_file_id = NULL WHERE id = $1`, [req.user.id]);
  if (old.rows[0]) {
    await query(`DELETE FROM files WHERE id = $1`, [old.rows[0].id]);
    await deleteStoredFiles(old.rows);
  }
  const user = await fresh(req.user.id);
  res.json({ user: publicUser(user, await setupState(user)) });
});

// ---------- personal API tokens ----------
router.get("/tokens", requireSetupComplete, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, prefix, scope, last_used_at, last_used_ip, expires_at, revoked_at, created_at
     FROM api_tokens WHERE user_id = $1 ORDER BY revoked_at NULLS FIRST, created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

const tokenSchema = z.object({
  name: z.string().trim().min(2, "Give it a name you'll recognise").max(80),
  scope: z.enum(["read", "write"]).default("read"),
  expires_in_days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
});

router.post("/tokens", requireSession, requireSetupComplete, async (req, res) => {
  const body = parse(tokenSchema, req.body);
  const { rows: count } = await query(`SELECT COUNT(*)::int AS n FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [req.user.id]);
  if (count[0].n >= 20) throw badRequest("You have 20 active tokens. Revoke one first.");
  const raw = `${API_TOKEN_PREFIX}${crypto.randomBytes(30).toString("base64url")}`;
  const { rows } = await query(
    `INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, expires_at)
     VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + ($6::int || ' days')::interval END)
     RETURNING id, name, prefix, scope, expires_at, created_at`,
    [req.user.id, body.name, sha256(raw), raw.slice(0, 10), body.scope, body.expires_in_days]
  );
  await audit(req, "token.created", { targetType: "api_token", targetId: rows[0].id, meta: { name: body.name, scope: body.scope } });
  res.status(201).json({ ...rows[0], token: raw });
});

router.delete("/tokens/:id", requireSetupComplete, async (req, res) => {
  const id = intParam(req.params.id);
  const { rows } = await query(
    `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING name`,
    [id, req.user.id]
  );
  if (!rows[0]) throw notFound("Token not found");
  await audit(req, "token.revoked", { targetType: "api_token", targetId: id, meta: { name: rows[0].name } });
  res.json({ ok: true });
});

// ---------- "download my data" ----------
router.get("/export", requireSession, requireSetupComplete, async (req, res) => {
  const id = req.user.id;
  const [tasks, comments, messages, logins, notifications] = await Promise.all([
    query(`SELECT id, title, description, status, priority, type, labels, due_date, created_at, completed_at FROM tasks WHERE assigned_to = $1 ORDER BY id`, [id]),
    query(`SELECT task_id, message, created_at FROM task_comments WHERE user_id = $1 ORDER BY id`, [id]),
    query(`SELECT sender_id, recipient_id, message, file_name, created_at FROM messages WHERE sender_id = $1 OR recipient_id = $1 ORDER BY id`, [id]),
    query(`SELECT ip_address, user_agent, success, reason, login_at FROM login_logs WHERE user_id = $1 ORDER BY id`, [id]),
    query(`SELECT type, title, body, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY id`, [id]),
  ]);
  await audit(req, "user.data_exported", { targetType: "user", targetId: id });
  res.setHeader("Content-Disposition", `attachment; filename="airlock-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exported_at: new Date().toISOString(),
    profile: publicUser(req.user),
    tasks: tasks.rows,
    comments: comments.rows,
    messages: messages.rows,
    sign_ins: logins.rows,
    notifications: notifications.rows,
  });
});

export default router;
