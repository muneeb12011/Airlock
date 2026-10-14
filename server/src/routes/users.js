// People: a directory everyone can read, and admin-only account management.
import express from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { requireAdmin, USER_COLUMNS } from "../middleware/auth.js";
import { parse, intParam, badRequest, notFound, conflict } from "../lib/http.js";
import { hashPassword } from "../lib/passwords.js";
import { tempPassword } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { disconnectUser } from "../lib/realtime.js";
import { deleteStoredFiles } from "../lib/fileShield.js";
import { avatarUrl } from "../middleware/auth.js";
import { emailEnabled, sendMail, appUrl } from "../lib/mailer.js";
import { createAuthToken } from "../lib/authTokens.js";
import { getSettings } from "../lib/settings.js";

const router = express.Router();

// Everyone: the people directory (for assignment pickers, @mentions, profiles).
router.get("/directory", async (_req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.name, u.role, u.title, u.timezone, u.avatar_file_id,
      COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)) FILTER (WHERE t.id IS NOT NULL), '[]') AS teams
    FROM users u
    LEFT JOIN team_members tm ON tm.user_id = u.id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE u.is_active
    GROUP BY u.id ORDER BY u.name`);
  res.json(rows.map(({ avatar_file_id, ...r }) => ({ ...r, avatar_url: avatarUrl(avatar_file_id) })));
});

router.use(requireAdmin);

router.get("/", async (_req, res) => {
  const { rows } = await query(`
    SELECT u.id, u.name, u.email, u.role, u.title, u.is_active, u.totp_enabled, u.must_change_password,
           u.last_login_at, u.created_at, u.locked_until, u.avatar_file_id,
           (SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name), '[]')
              FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = u.id) AS teams,
           (u.locked_until IS NOT NULL AND u.locked_until > now()) AS is_locked,
           COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress'))::int AS open_tasks,
           COUNT(t.id) FILTER (WHERE t.status = 'in_review')::int AS in_review,
           COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_tasks,
           COUNT(t.id) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue_tasks
    FROM users u
    LEFT JOIN tasks t ON t.assigned_to = u.id
    GROUP BY u.id
    ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`);
  res.json(rows.map(({ avatar_file_id, ...r }) => ({ ...r, avatar_url: avatarUrl(avatar_file_id) })));
});

async function setTeams(userId, teamIds) {
  if (!Array.isArray(teamIds)) return;
  await query(`DELETE FROM team_members WHERE user_id = $1 AND NOT (team_id = ANY($2::int[]))`, [userId, teamIds]);
  if (teamIds.length) {
    await query(
      `INSERT INTO team_members (team_id, user_id) SELECT id, $1 FROM teams WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING`,
      [userId, teamIds]
    );
  }
}

async function sendInvite(user, inviter) {
  const token = await createAuthToken(user.id, "invite", 60 * 24 * 7);
  const { workspace_name } = await getSettings();
  return sendMail({
    to: user.email,
    subject: `${inviter.name} invited you to ${workspace_name}`,
    heading: `You're invited to ${workspace_name}`,
    text: `${inviter.name} added you as ${user.role === "member" ? "a team member" : `a${user.role === "admin" ? "n" : ""} ${user.role}`}. Choose a password to activate your account. This link expires in 7 days.`,
    cta: "Set up my account",
    ctaUrl: appUrl(`/reset?token=${token}&invite=1`),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(150),
  role: z.enum(["admin", "manager", "member"]).default("member"),
  title: z.string().trim().max(100).optional(),
  team_ids: z.array(z.number().int().positive()).max(50).optional(),
  send_invite: z.boolean().optional(),
});

router.post("/", async (req, res) => {
  const body = parse(createSchema, req.body);
  const invite = body.send_invite !== false && emailEnabled();
  const temp = tempPassword();
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role, title, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${USER_COLUMNS}`,
      [body.name, body.email, await hashPassword(temp), body.role, body.title || null, !invite]
    );
    await setTeams(rows[0].id, body.team_ids);
    await audit(req, "user.created", { targetType: "user", targetId: rows[0].id, meta: { email: body.email, role: body.role, invited: invite } });
    if (invite) {
      await sendInvite(rows[0], req.user);
      return res.status(201).json({ user: rows[0], invited: true });
    }
    res.status(201).json({ user: rows[0], temp_password: temp });
  } catch (err) {
    if (err.code === "23505") throw conflict("Someone already uses that email.");
    throw err;
  }
});

async function loadUser(id) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound("User not found");
  return rows[0];
}

async function activeAdminCount() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND is_active`);
  return rows[0].n;
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  title: z.string().trim().max(100).nullable().optional(),
  role: z.enum(["admin", "manager", "member"]).optional(),
  is_active: z.boolean().optional(),
  team_ids: z.array(z.number().int().positive()).max(50).optional(),
});

router.post("/:id/invite", async (req, res) => {
  const id = intParam(req.params.id);
  const target = await loadUser(id);
  if (!emailEnabled()) throw badRequest("Email isn't configured on this server. Use “Reset password” to get a one-time password instead.");
  await sendInvite(target, req.user);
  await audit(req, "user.invite_sent", { targetType: "user", targetId: id, meta: { email: target.email } });
  res.json({ ok: true });
});

router.patch("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const body = parse(updateSchema, req.body);
  const target = await loadUser(id);
  const isSelf = id === req.user.id;

  if (isSelf && ((body.role && body.role !== "admin") || body.is_active === false)) {
    throw badRequest("You can't demote or disable your own account.");
  }
  const losingAdmin = target.role === "admin" && target.is_active && ((body.role && body.role !== "admin") || body.is_active === false);
  if (losingAdmin && (await activeAdminCount()) <= 1) throw badRequest("There must always be at least one active admin.");

  if ("title" in (req.body || {})) await query(`UPDATE users SET title = $2 WHERE id = $1`, [id, body.title || null]);
  await setTeams(id, body.team_ids);
  const { rows } = await query(
    `UPDATE users SET
       name = COALESCE($2::varchar, name),
       role = COALESCE($3::varchar, role),
       is_active = COALESCE($4::boolean, is_active),
       token_version = CASE WHEN $4::boolean = false OR ($3::varchar IS NOT NULL AND $3::varchar <> role)
                            THEN token_version + 1 ELSE token_version END,
       updated_at = now()
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [id, body.name ?? null, body.role ?? null, body.is_active ?? null]
  );
  if (body.is_active === false || (body.role && body.role !== target.role)) disconnectUser(id);
  await audit(req, "user.updated", { targetType: "user", targetId: id, meta: body });
  res.json(rows[0]);
});

router.post("/:id/reset-password", async (req, res) => {
  const id = intParam(req.params.id);
  const target = await loadUser(id);
  const temp = tempPassword();
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = true, token_version = token_version + 1,
       failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
    [id, await hashPassword(temp)]
  );
  disconnectUser(id);
  await audit(req, "user.password_reset", { targetType: "user", targetId: id, meta: { email: target.email } });
  res.json({ temp_password: temp });
});

router.post("/:id/unlock", async (req, res) => {
  const id = intParam(req.params.id);
  await loadUser(id);
  await query(`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [id]);
  await audit(req, "user.unlocked", { targetType: "user", targetId: id });
  res.json({ ok: true });
});

// For a member who lost their phone: turns their 2FA off so they can re-enrol.
router.post("/:id/reset-2fa", async (req, res) => {
  const id = intParam(req.params.id);
  const target = await loadUser(id);
  await query(
    `UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL,
       recovery_codes = '[]'::jsonb, token_version = token_version + 1 WHERE id = $1`,
    [id]
  );
  disconnectUser(id);
  await audit(req, "user.2fa_reset", { targetType: "user", targetId: id, meta: { email: target.email } });
  notify(id, {
    type: "security",
    title: "An admin reset your two-factor login",
    body: "Set it up again from your account page.",
    link: "/account",
  });
  res.json({ ok: true });
});

router.post("/:id/revoke-sessions", async (req, res) => {
  const id = intParam(req.params.id);
  await loadUser(id);
  await query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [id]);
  disconnectUser(id);
  await audit(req, "user.sessions_revoked", { targetType: "user", targetId: id });
  res.json({ ok: true });
});

// Permanently removes a user, every task assigned to them, their messages and
// every file on disk tied to any of that.
router.delete("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  if (id === req.user.id) throw badRequest("You can't delete your own account.");
  const target = await loadUser(id);
  if (target.role === "admin" && target.is_active && (await activeAdminCount()) <= 1) {
    throw badRequest("There must always be at least one active admin.");
  }

  const files = await tx(async (c) => {
    const f = await c.query(
      `SELECT DISTINCT f.storage_key, NULL::text AS file_path FROM files f
         WHERE f.id IN (
           SELECT s.file_id FROM task_submissions s JOIN tasks t ON t.id = s.task_id
             WHERE (s.submitted_by = $1 OR t.assigned_to = $1) AND s.file_id IS NOT NULL
           UNION
           SELECT m.file_id FROM messages m WHERE (m.sender_id = $1 OR m.recipient_id = $1) AND m.file_id IS NOT NULL)
       UNION ALL
       SELECT NULL, s.file_path FROM task_submissions s JOIN tasks t ON t.id = s.task_id
         WHERE (s.submitted_by = $1 OR t.assigned_to = $1) AND s.file_path IS NOT NULL
       UNION ALL
       SELECT NULL, m.file_path FROM messages m
         WHERE (m.sender_id = $1 OR m.recipient_id = $1) AND m.file_path IS NOT NULL`,
      [id]
    );
    const fileIds = await c.query(
      `SELECT s.file_id AS id FROM task_submissions s JOIN tasks t ON t.id = s.task_id
         WHERE (s.submitted_by = $1 OR t.assigned_to = $1) AND s.file_id IS NOT NULL
       UNION
       SELECT m.file_id FROM messages m WHERE (m.sender_id = $1 OR m.recipient_id = $1) AND m.file_id IS NOT NULL`,
      [id]
    );
    await c.query(`DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1`, [id]);
    await c.query(`DELETE FROM tasks WHERE assigned_to = $1`, [id]);
    await c.query(`DELETE FROM task_comments WHERE user_id = $1`, [id]);
    await c.query(`DELETE FROM task_submissions WHERE submitted_by = $1`, [id]);
    await c.query(`UPDATE tasks SET assigned_by = NULL WHERE assigned_by = $1`, [id]);
    if (fileIds.rows.length) {
      await c.query(`DELETE FROM files WHERE id = ANY($1::uuid[])`, [fileIds.rows.map((r) => r.id)]);
    }
    const avatar = await c.query(
      `SELECT f.id, f.storage_key FROM users u JOIN files f ON f.id = u.avatar_file_id WHERE u.id = $1`,
      [id]
    );
    await c.query(`DELETE FROM users WHERE id = $1`, [id]);
    if (avatar.rows[0]) await c.query(`DELETE FROM files WHERE id = $1`, [avatar.rows[0].id]);
    return [...f.rows, ...avatar.rows];
  });

  await deleteStoredFiles(files);
  disconnectUser(id);
  await audit(req, "user.deleted", {
    targetType: "user",
    targetId: id,
    meta: { name: target.name, email: target.email, files_removed: files.length },
  });
  res.json({ ok: true, deleted: { id, name: target.name } });
});

export default router;
