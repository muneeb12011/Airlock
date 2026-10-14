import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { requireAdmin, restrictToAllowedIPs } from "../middleware/auth.js";
import { parse, intParam, badRequest, notFound } from "../lib/http.js";
import { verifyChain } from "../lib/audit.js";
import { audit } from "../lib/audit.js";
import { getSettings, updateSettings } from "../lib/settings.js";
import { publicFile, sendStoredFile } from "../lib/fileShield.js";
import { generateTaskPDF, generateTaskDocx, tasksToCsv } from "../services/export.js";
import { config } from "../config.js";
import { emailEnabled } from "../lib/mailer.js";
import { canManageTask, taskVisibility } from "../lib/access.js";
import { forbidden } from "../lib/http.js";

const router = express.Router();
// Exports are open to managers for tasks they manage; everything else is admin-only.
const LEAD_PATHS = [/^\/tasks\/\d+\/export$/, /^\/submissions\/\d+\/file$/, /^\/tasks\.csv$/];
router.use((req, res, next) => {
  if (req.user.role === "manager" && LEAD_PATHS.some((r) => r.test(req.path))) return next();
  return requireAdmin(req, res, next);
});

// ---------- login activity ----------
const logsSchema = z.object({
  result: z.enum(["all", "success", "failed"]).default("all"),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

router.get("/login-logs", async (req, res) => {
  const f = parse(logsSchema, req.query);
  const where = [];
  const params = [];
  if (f.result === "success") where.push("l.success");
  if (f.result === "failed") where.push("NOT l.success");
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR l.email_attempted ILIKE $${params.length} OR l.ip_address ILIKE $${params.length})`);
  }
  const pageSize = 50;
  params.push(pageSize + 1, (f.page - 1) * pageSize);
  const { rows } = await query(
    `SELECT l.id, l.ip_address, l.user_agent, l.login_at, l.success, l.reason, l.new_ip,
            COALESCE(u.email, l.email_attempted) AS email, u.name, u.role
     FROM login_logs l LEFT JOIN users u ON u.id = l.user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY l.login_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ items: rows.slice(0, pageSize), has_more: rows.length > pageSize, page: f.page });
});

// ---------- audit log ----------
const auditSchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

router.get("/audit", async (req, res) => {
  const f = parse(auditSchema, req.query);
  const params = [];
  let where = "";
  if (f.q) {
    params.push(`%${f.q}%`);
    where = `WHERE action ILIKE $1 OR actor_name ILIKE $1 OR meta::text ILIKE $1`;
  }
  const pageSize = 50;
  params.push(pageSize + 1, (f.page - 1) * pageSize);
  const { rows } = await query(
    `SELECT id, actor_name, action, target_type, target_id, meta, ip_address, created_at, hash
     FROM audit_log ${where} ORDER BY id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ items: rows.slice(0, pageSize), has_more: rows.length > pageSize, page: f.page });
});

router.post("/audit/verify", async (req, res) => {
  const result = await verifyChain();
  await audit(req, "audit.verified", { meta: { ok: result.ok, checked: result.checked, broken_at: result.brokenAt } });
  res.json(result);
});

// ---------- File Shield ----------
router.get("/files/blocked", async (_req, res) => {
  const { rows } = await query(
    `SELECT b.*, u.name AS user_name, (h.sha256 IS NOT NULL) AS banned
     FROM blocked_uploads b
     LEFT JOIN users u ON u.id = b.user_id
     LEFT JOIN banned_hashes h ON h.sha256 = b.sha256
     ORDER BY b.created_at DESC LIMIT 100`
  );
  res.json(rows);
});

router.get("/files/recent", async (_req, res) => {
  const { rows } = await query(
    `SELECT f.*, u.name AS uploaded_by_name, (h.sha256 IS NOT NULL) AS banned
     FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
     LEFT JOIN banned_hashes h ON h.sha256 = f.sha256
     ORDER BY f.created_at DESC LIMIT 100`
  );
  res.json(rows.map((r) => ({ ...publicFile(r), uploaded_by_name: r.uploaded_by_name, banned: r.banned })));
});

router.get("/files/bans", async (_req, res) => {
  const { rows } = await query(
    `SELECT h.*, u.name AS banned_by_name FROM banned_hashes h LEFT JOIN users u ON u.id = h.banned_by ORDER BY h.created_at DESC`
  );
  res.json(rows);
});

const banSchema = z.object({
  sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/, "Must be a SHA-256 hex digest"),
  reason: z.string().trim().max(300).optional(),
});

router.post("/files/bans", async (req, res) => {
  const body = parse(banSchema, req.body);
  await query(
    `INSERT INTO banned_hashes (sha256, reason, banned_by) VALUES ($1,$2,$3)
     ON CONFLICT (sha256) DO UPDATE SET reason = EXCLUDED.reason`,
    [body.sha256, body.reason || null, req.user.id]
  );
  await audit(req, "file.hash_banned", { targetType: "sha256", targetId: body.sha256, meta: { reason: body.reason || null } });
  res.status(201).json({ ok: true });
});

router.delete("/files/bans/:sha", async (req, res) => {
  const sha = String(req.params.sha).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) throw badRequest("Invalid hash");
  await query(`DELETE FROM banned_hashes WHERE sha256 = $1`, [sha]);
  await audit(req, "file.hash_unbanned", { targetType: "sha256", targetId: sha });
  res.json({ ok: true });
});

// ---------- settings ----------
router.get("/settings", async (_req, res) => {
  const s = await getSettings();
  res.json({
    ...s,
    env_origins: config.frontendOrigins,
    email_enabled: emailEnabled(),
    clamav_enabled: Boolean(process.env.CLAMAV_HOST),
    admin_allowed_ips: config.adminAllowedIps,
    trust_proxy: config.trustProxy,
  });
});

const originSchema = z
  .string()
  .trim()
  .transform((o) => o.replace(/\/$/, "").toLowerCase())
  .refine((o) => {
    try {
      const u = new URL(o);
      const local = ["localhost", "127.0.0.1"].includes(u.hostname);
      return (u.protocol === "https:" || (u.protocol === "http:" && local)) && u.pathname === "/" && !u.search && `${u.protocol}//${u.host}` === o;
    } catch {
      return false;
    }
  }, "Each origin must look like https://app.example.com — no path, and http:// only for localhost");

const settingsSchema = z.object({
  enforce_2fa: z.boolean().optional(),
  allow_p2p: z.boolean().optional(),
  workspace_name: z.string().trim().min(2).max(60).optional(),
  extra_origins: z.array(originSchema).max(20).optional(),
  member_dm: z.enum(["off", "team", "all"]).optional(),
  retention_days: z.number().int().min(30).max(3650).optional(),
  default_due_days: z.number().int().min(0).max(90).optional(),
  channels: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});

router.patch("/settings", async (req, res) => {
  const body = parse(settingsSchema, req.body);
  if (body.enforce_2fa === true && !req.user.totp_enabled) {
    throw badRequest("Turn on two-factor for your own account first, or you'd lock yourself out.");
  }
  const settings = await updateSettings(body);
  await audit(req, "settings.updated", { meta: body });
  res.json(settings);
});

// ---------- data leaving the airlock: approved networks only ----------
async function exportBundle(taskId) {
  const t = await query(
    `SELECT t.*, a.name AS assignee_name, b.name AS assigned_by_name, p.name AS project_name,
       CASE WHEN p.key IS NOT NULL THEN p.key || '-' || t.number END AS key FROM tasks t
     LEFT JOIN users a ON a.id = t.assigned_to LEFT JOIN users b ON b.id = t.assigned_by
     LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
    [taskId]
  );
  if (!t.rows[0]) throw notFound("Task not found");
  const subs = await query(
    `SELECT s.*, u.name AS submitted_by_name, r.name AS reviewed_by_name, row_to_json(f) AS file
     FROM task_submissions s LEFT JOIN users u ON u.id = s.submitted_by
     LEFT JOIN users r ON r.id = s.reviewed_by LEFT JOIN files f ON f.id = s.file_id
     WHERE s.task_id = $1 ORDER BY s.submitted_at DESC`,
    [taskId]
  );
  const comments = await query(
    `SELECT c.*, u.name AS author_name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = $1 ORDER BY c.created_at`,
    [taskId]
  );
  return { task: t.rows[0], submissions: subs.rows.map((s) => ({ ...s, file: publicFile(s.file) })), comments: comments.rows };
}

router.get("/tasks/:id/export", restrictToAllowedIPs, async (req, res) => {
  const id = intParam(req.params.id);
  const format = req.query.format === "docx" ? "docx" : "pdf";
  const { task, submissions, comments } = await exportBundle(id);
  if (!(await canManageTask(req.user, task))) throw forbidden("You can only export tasks you manage.");
  await audit(req, "task.exported", { targetType: "task", targetId: id, meta: { format, title: task.title } });
  if (format === "pdf") generateTaskPDF(task, submissions, comments, res, req.user.name);
  else await generateTaskDocx(task, submissions, comments, res, req.user.name);
});

router.get("/submissions/:id/file", restrictToAllowedIPs, async (req, res) => {
  const id = intParam(req.params.id);
  const { rows } = await query(
    `SELECT s.task_id, s.file_path, s.file_name, row_to_json(f) AS file, t.assigned_by, t.project_id, t.assigned_to
     FROM task_submissions s LEFT JOIN files f ON f.id = s.file_id JOIN tasks t ON t.id = s.task_id WHERE s.id = $1`,
    [id]
  );
  const s = rows[0];
  if (!s) throw notFound("Submission not found");
  if (!(await canManageTask(req.user, s))) throw forbidden("You can only download deliverables for tasks you manage.");
  await audit(req, "file.downloaded", {
    targetType: "submission",
    targetId: id,
    meta: { task_id: s.task_id, name: s.file?.original_name || s.file_name, sha256: s.file?.sha256 || null },
  });
  await sendStoredFile(req, res, { file: s.file, legacyPath: s.file_path, legacyName: s.file_name });
});

router.get("/tasks.csv", restrictToAllowedIPs, async (req, res) => {
  const params = [];
  const { rows } = await query(
    `SELECT t.*, u.name AS assignee_name, (t.status <> 'completed' AND t.due_date < CURRENT_DATE) AS is_overdue,
       p.key || '-' || t.number AS key, p.name AS project_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN projects p ON p.id = t.project_id
     WHERE ${taskVisibility(req.user, params)} ORDER BY t.id`,
    params
  );
  await audit(req, "task.exported", { meta: { format: "csv", count: rows.length } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="airlock-tasks-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + tasksToCsv(rows));
});

export default router;
