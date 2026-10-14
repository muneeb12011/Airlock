// Dashboards and delivery reports for admins and managers, always scoped to
// the tasks the caller is allowed to see.
import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse, forbidden } from "../lib/http.js";
import { canLead, isAdmin, taskVisibility } from "../lib/access.js";
import { avatarUrl } from "../middleware/auth.js";

const router = express.Router();
router.use((req, _res, next) => (canLead(req.user) ? next() : next(forbidden("Reports are for admins and managers."))));

router.get("/overview", async (req, res) => {
  const p = [];
  const vis = taskVisibility(req.user, p);
  const [counts, workload, dueSoon, recent, projects] = await Promise.all([
    query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status <> 'completed' AND due_date < CURRENT_DATE)::int AS overdue,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '7 days')::int AS completed_7d
       FROM tasks t WHERE ${vis}`,
      p
    ),
    query(
      `SELECT u.id, u.name, u.avatar_file_id,
        COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress'))::int AS open,
        COUNT(t.id) FILTER (WHERE t.status = 'in_review')::int AS in_review,
        COUNT(t.id) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue,
        COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at > now() - interval '30 days')::int AS done_30d,
        COALESCE(SUM(t.estimate) FILTER (WHERE t.status IN ('pending','in_progress')), 0)::int AS open_points
       FROM tasks t JOIN users u ON u.id = t.assigned_to
       WHERE ${vis} AND u.is_active
       GROUP BY u.id ORDER BY open DESC, u.name LIMIT 30`,
      p
    ),
    query(
      `SELECT t.id, t.title, t.due_date, t.priority, t.status, u.name AS assignee_name, pr.key || '-' || t.number AS key
       FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN projects pr ON pr.id = t.project_id
       WHERE ${vis} AND t.status <> 'completed' AND t.due_date IS NOT NULL AND t.due_date <= CURRENT_DATE + 3
       ORDER BY t.due_date ASC LIMIT 8`,
      p
    ),
    isAdmin(req.user)
      ? query(`SELECT id, actor_name, action, target_type, target_id, meta, created_at FROM audit_log
               WHERE action NOT IN ('auth.login','file.downloaded','audit.verified') ORDER BY id DESC LIMIT 12`)
      : query(
          `SELECT a.id, a.actor_name, a.action, a.target_type, a.target_id, a.meta, a.created_at FROM audit_log a
           WHERE a.target_type = 'task' AND a.target_id IN (SELECT t.id::text FROM tasks t WHERE ${vis})
           ORDER BY a.id DESC LIMIT 12`,
          p
        ),
    query(
      `SELECT pr.id, pr.key, pr.name, pr.color, pr.kind, pr.end_date,
         COUNT(t.id)::int AS total, COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS done,
         COUNT(t.id) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue
       FROM projects pr LEFT JOIN tasks t ON t.project_id = pr.id
       WHERE pr.status = 'active' AND pr.id IN (SELECT DISTINCT t.project_id FROM tasks t WHERE ${vis} AND t.project_id IS NOT NULL
                                                UNION SELECT project_id FROM project_members WHERE user_id = ${Number(req.user.id)}::int)
       GROUP BY pr.id ORDER BY pr.end_date NULLS LAST, pr.name LIMIT 12`,
      p
    ),
  ]);

  let security = null;
  if (isAdmin(req.user)) {
    const s = await query(`SELECT
        (SELECT COUNT(*)::int FROM login_logs WHERE NOT success AND login_at > now() - interval '24 hours') AS failed_logins_24h,
        (SELECT COUNT(*)::int FROM users WHERE locked_until > now()) AS locked_accounts,
        (SELECT COUNT(*)::int FROM users WHERE is_active) AS active_users,
        (SELECT COUNT(*)::int FROM users WHERE is_active AND totp_enabled) AS users_with_2fa,
        (SELECT COUNT(*)::int FROM blocked_uploads WHERE created_at > now() - interval '7 days') AS blocked_uploads_7d,
        (SELECT COUNT(*)::int FROM login_logs WHERE success AND new_ip AND login_at > now() - interval '7 days') AS new_ip_logins_7d`);
    security = s.rows[0];
  }

  res.json({
    tasks: counts.rows[0],
    workload: workload.rows.map(({ avatar_file_id, ...w }) => ({ ...w, avatar_url: avatarUrl(avatar_file_id) })),
    due_soon: dueSoon.rows,
    recent: recent.rows,
    projects: projects.rows,
    security,
  });
});

const reportSchema = z.object({
  project: z.coerce.number().int().positive().optional(),
  weeks: z.coerce.number().int().min(4).max(26).default(8),
});

router.get("/delivery", async (req, res) => {
  const { project, weeks } = parse(reportSchema, req.query);
  const p = [];
  const vis = taskVisibility(req.user, p);
  let scope = vis;
  if (project) {
    p.push(project);
    scope += ` AND t.project_id = $${p.length}`;
  }
  p.push(weeks);
  const W = `$${p.length}`;

  const [weekly, people, labels, types, summary] = await Promise.all([
    query(
      `WITH w AS (
         SELECT generate_series(date_trunc('week', now()) - ((${W}::int - 1) || ' weeks')::interval, date_trunc('week', now()), '1 week') AS start
       )
       SELECT to_char(w.start, 'YYYY-MM-DD') AS week,
         (SELECT COUNT(*)::int FROM tasks t WHERE ${scope} AND t.created_at >= w.start AND t.created_at < w.start + interval '1 week') AS created,
         (SELECT COUNT(*)::int FROM tasks t WHERE ${scope} AND t.completed_at >= w.start AND t.completed_at < w.start + interval '1 week') AS completed,
         (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400)::numeric, 1)::float
            FROM tasks t WHERE ${scope} AND t.completed_at >= w.start AND t.completed_at < w.start + interval '1 week') AS cycle_days
       FROM w ORDER BY w.start`,
      p
    ),
    query(
      `SELECT u.id, u.name,
         COUNT(t.id) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval)::int AS completed,
         COUNT(t.id) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval AND t.due_date IS NOT NULL AND t.completed_at::date <= t.due_date)::int AS on_time,
         COUNT(t.id) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue,
         COALESCE(SUM(t.estimate) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval), 0)::int AS points
       FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE ${scope}
       GROUP BY u.id ORDER BY completed DESC, u.name LIMIT 40`,
      p
    ),
    query(
      `SELECT l AS label, COUNT(*)::int AS n FROM tasks t, unnest(t.labels) l
       WHERE ${scope} AND t.created_at > now() - (${W}::int || ' weeks')::interval GROUP BY l ORDER BY n DESC LIMIT 12`,
      p
    ),
    query(
      `SELECT t.type, COUNT(*)::int AS n FROM tasks t WHERE ${scope} AND t.created_at > now() - (${W}::int || ' weeks')::interval GROUP BY t.type ORDER BY n DESC`,
      p
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval)::int AS completed,
         COUNT(*) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval AND t.due_date IS NOT NULL)::int AS with_due,
         COUNT(*) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval AND t.due_date IS NOT NULL AND t.completed_at::date <= t.due_date)::int AS on_time,
         ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400) FILTER (WHERE t.completed_at > now() - (${W}::int || ' weeks')::interval)::numeric, 1)::float AS avg_cycle_days,
         (SELECT ROUND(AVG(n)::numeric, 1)::float FROM (
            SELECT COUNT(*) AS n FROM task_submissions s JOIN tasks t ON t.id = s.task_id
            WHERE ${scope} AND t.completed_at > now() - (${W}::int || ' weeks')::interval GROUP BY s.task_id) x) AS avg_review_rounds,
         COUNT(*) FILTER (WHERE t.status <> 'completed')::int AS open,
         COUNT(*) FILTER (WHERE t.status <> 'completed' AND t.due_date < CURRENT_DATE)::int AS overdue
       FROM tasks t WHERE ${scope}`,
      p
    ),
  ]);

  res.json({ weeks, weekly: weekly.rows, people: people.rows, labels: labels.rows, types: types.rows, summary: summary.rows[0] });
});

export default router;
