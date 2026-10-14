// Direct messages. Admins and managers can message anyone. Members can always
// reach admins and managers; member-to-member messaging follows the workspace
// setting (off / people who share a team or project / everyone).
import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse, intParam, badRequest, forbidden, notFound } from "../lib/http.js";
import { shieldUpload, publicFile, sendStoredFile, deleteStoredFiles } from "../lib/fileShield.js";
import { emitToUser } from "../lib/realtime.js";
import { audit } from "../lib/audit.js";
import { canMessage, canLead } from "../lib/access.js";
import { getSettings } from "../lib/settings.js";
import { avatarUrl } from "../middleware/auth.js";

const router = express.Router();

const MESSAGE_SELECT = `
  SELECT m.id, m.sender_id, m.recipient_id, m.message, m.created_at, m.read_at,
         m.file_name AS legacy_file_name, (m.file_path IS NOT NULL) AS has_legacy_file,
         row_to_json(f) AS file
  FROM messages m LEFT JOIN files f ON f.id = m.file_id`;

const shape = (m) => ({ ...m, file: publicFile(m.file) });

async function counterpart(req, otherId) {
  if (otherId === req.user.id) throw badRequest("You can't message yourself.");
  const { rows } = await query(`SELECT id, name, role, is_active FROM users WHERE id = $1`, [otherId]);
  const other = rows[0];
  if (!other) throw notFound("User not found");
  if (!(await canMessage(req.user, other))) throw forbidden("You can't message this person. Ask an admin if you need to.");
  return other;
}

// Everyone you can talk to, with the latest message and unread count.
router.get("/conversations", async (req, res) => {
  const lead = canLead(req.user);
  const { member_dm } = await getSettings();
  // Members: leads always; other members depending on the workspace setting.
  const scope = lead || member_dm === "all"
    ? ""
    : member_dm === "team"
      ? `AND (u.role IN ('admin','manager') OR u.id IN (
           SELECT y.user_id FROM team_members x JOIN team_members y ON x.team_id = y.team_id WHERE x.user_id = $1
           UNION SELECT y.user_id FROM project_members x JOIN project_members y ON x.project_id = y.project_id WHERE x.user_id = $1))`
      : "AND u.role IN ('admin','manager')";
  const { rows } = await query(
    `SELECT u.id, u.name, u.role, u.email, u.title, u.avatar_file_id,
       lm.message AS last_message, lm.created_at AS last_at, lm.sender_id AS last_sender_id,
       (lm.file_id IS NOT NULL OR lm.file_path IS NOT NULL) AS last_has_file,
       (SELECT COUNT(*)::int FROM messages x WHERE x.sender_id = u.id AND x.recipient_id = $1 AND x.read_at IS NULL) AS unread
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM messages m
       WHERE (m.sender_id = u.id AND m.recipient_id = $1) OR (m.sender_id = $1 AND m.recipient_id = u.id)
       ORDER BY m.created_at DESC LIMIT 1
     ) lm ON true
     WHERE u.id <> $1 AND u.is_active ${scope}
     ORDER BY lm.created_at DESC NULLS LAST, u.name`,
    [req.user.id]
  );
  res.json(rows.map(({ avatar_file_id, ...r }) => ({ ...r, avatar_url: avatarUrl(avatar_file_id) })));
});

router.get("/unread-count", async (req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM messages WHERE recipient_id = $1 AND read_at IS NULL`,
    [req.user.id]
  );
  res.json({ count: rows[0].n });
});

router.get("/file/:messageId", async (req, res) => {
  const id = intParam(req.params.messageId);
  const { rows } = await query(
    `SELECT m.sender_id, m.recipient_id, m.file_path, m.file_name, row_to_json(f) AS file
     FROM messages m LEFT JOIN files f ON f.id = m.file_id WHERE m.id = $1`,
    [id]
  );
  const m = rows[0];
  if (!m) throw notFound("Message not found");
  if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) throw forbidden("Not your conversation.");
  await audit(req, "file.downloaded", {
    targetType: "message",
    targetId: id,
    meta: { name: m.file?.original_name || m.file_name, sha256: m.file?.sha256 || null },
  });
  await sendStoredFile(req, res, { file: m.file, legacyPath: m.file_path, legacyName: m.file_name });
});

const pageSchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get("/:otherId", async (req, res) => {
  const other = await counterpart(req, intParam(req.params.otherId));
  const { before, limit } = parse(pageSchema, req.query);
  const { rows } = await query(
    `${MESSAGE_SELECT}
     WHERE ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
       ${before ? "AND m.id < $4" : ""}
     ORDER BY m.id DESC LIMIT $3`,
    before ? [req.user.id, other.id, limit + 1, before] : [req.user.id, other.id, limit + 1]
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse().map(shape);

  const marked = await query(
    `UPDATE messages SET read_at = now() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL RETURNING id`,
    [other.id, req.user.id]
  );
  if (marked.rows.length) emitToUser(other.id, "message:read", { by: req.user.id, ids: marked.rows.map((r) => r.id) });

  res.json({ messages: page, has_more: hasMore, contact: { id: other.id, name: other.name, role: other.role } });
});

router.post("/:otherId/read", async (req, res) => {
  const otherId = intParam(req.params.otherId);
  const marked = await query(
    `UPDATE messages SET read_at = now() WHERE sender_id = $1 AND recipient_id = $2 AND read_at IS NULL RETURNING id`,
    [otherId, req.user.id]
  );
  if (marked.rows.length) emitToUser(otherId, "message:read", { by: req.user.id, ids: marked.rows.map((r) => r.id) });
  res.json({ ok: true, marked: marked.rows.length });
});

const sendSchema = z.object({ message: z.string().trim().max(8000).optional() });

router.post("/:otherId", shieldUpload("file", "message"), async (req, res) => {
  const file = req.shieldedFile;
  try {
    const other = await counterpart(req, intParam(req.params.otherId));
    if (!other.is_active) throw badRequest("That account is disabled.");
    const { message } = parse(sendSchema, req.body);
    if (!message && !file) throw badRequest("Type a message or attach a file.");

    const ins = await query(
      `INSERT INTO messages (sender_id, recipient_id, message, file_id, file_name)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user.id, other.id, message || null, file?.id || null, file?.original_name || null]
    );
    const { rows } = await query(`${MESSAGE_SELECT} WHERE m.id = $1`, [ins.rows[0].id]);
    const msg = shape(rows[0]);
    if (file) {
      await audit(req, "file.shared", {
        targetType: "message",
        targetId: msg.id,
        meta: { to: other.name, name: file.original_name, sha256: file.sha256, risk: file.risk_level },
      });
    }
    emitToUser(other.id, "message:new", { ...msg, sender_name: req.user.name });
    emitToUser(req.user.id, "message:new", { ...msg, sender_name: req.user.name });
    res.status(201).json(msg);
  } catch (err) {
    if (file) {
      await query(`DELETE FROM files WHERE id = $1`, [file.id]).catch(() => {});
      await deleteStoredFiles([file]);
    }
    throw err;
  }
});

export default router;
