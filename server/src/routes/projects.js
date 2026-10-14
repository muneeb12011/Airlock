// Projects: campaigns for marketing, products/repos for engineering, anything
// with a set of people and a stream of tasks. Each project has a short key
// (MKT, WEB) so tasks get human-friendly references like WEB-42.
import express from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { parse, intParam, notFound, forbidden, conflict, badRequest } from "../lib/http.js";
import { canLead, isAdmin, canManageProject, projectVisibility, isProjectMember } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { joinProject, leaveProject } from "../lib/realtime.js";
import { avatarUrl } from "../middleware/auth.js";
import { createTaskFromTemplate, nextRunDate } from "../lib/templates.js";
import { TYPES, PRIORITIES } from "../lib/constants.js";
import { afterTaskCreated } from "../lib/taskOps.js";

const router = express.Router();

export const KINDS = ["general", "marketing", "engineering", "design", "ops", "sales"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable().optional().or(z.literal("").transform(() => null));

const projectSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, "2–8 letters or digits, starting with a letter (e.g. MKT, WEB2)"),
  name: z.string().trim().min(2, "Name is too short").max(120),
  description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(KINDS).default("general"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  team_id: z.number().int().positive().nullable().optional(),
  goal: z.string().trim().max(500).nullable().optional(),
  start_date: date,
  end_date: date,
  member_ids: z.array(z.number().int().positive()).max(500).optional(),
  add_team_members: z.boolean().optional(),
});

const PROJECT_SELECT = `
  SELECT p.*, o.name AS owner_name, tm.name AS team_name,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS done_count,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_review') AS review_count,
    (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status <> 'completed' AND t.due_date < CURRENT_DATE) AS overdue_count,
    (SELECT COUNT(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count
  FROM projects p
  LEFT JOIN users o ON o.id = p.owner_id
  LEFT JOIN teams tm ON tm.id = p.team_id`;

async function loadProject(id) {
  const { rows } = await query(`${PROJECT_SELECT} WHERE p.id = $1`, [id]);
  if (!rows[0]) throw notFound("Project not found");
  return rows[0];
}

async function assertCanSee(user, project) {
  if (isAdmin(user) || project.owner_id === user.id || (await isProjectMember(user.id, project.id))) return;
  throw forbidden("You're not on this project.");
}

async function addMembers(projectId, ids, by) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { rows } = await query(
    `INSERT INTO project_members (project_id, user_id)
     SELECT $1, id FROM users WHERE id = ANY($2::int[]) AND is_active
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [projectId, unique]
  );
  const added = rows.map((r) => r.user_id);
  added.forEach((uid) => joinProject(uid, projectId));
  return added.filter((uid) => uid !== by?.id);
}

router.get("/", async (req, res) => {
  const params = [];
  const vis = projectVisibility(req.user, params);
  const status = req.query.status === "archived" ? "archived" : req.query.status === "all" ? null : "active";
  if (status) params.push(status);
  const { rows } = await query(
    `${PROJECT_SELECT} WHERE ${vis} ${status ? `AND p.status = $${params.length}` : ""} ORDER BY p.status, p.name`,
    params
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  if (!canLead(req.user)) throw forbidden("Only admins and managers can create projects.");
  const body = parse(projectSchema, req.body);
  if (body.start_date && body.end_date && body.end_date < body.start_date) throw badRequest("End date is before the start date.");
  let project;
  try {
    const { rows } = await query(
      `INSERT INTO projects (key, name, description, kind, color, team_id, owner_id, goal, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [body.key, body.name, body.description || null, body.kind, body.color || "#2f5aa8", body.team_id || null, req.user.id, body.goal || null, body.start_date || null, body.end_date || null]
    );
    project = rows[0];
  } catch (err) {
    if (err.code === "23505") throw conflict(`The key ${body.key} is already used by another project.`);
    throw err;
  }
  let ids = [req.user.id, ...(body.member_ids || [])];
  if (body.team_id && body.add_team_members !== false) {
    const t = await query(`SELECT user_id FROM team_members WHERE team_id = $1`, [body.team_id]);
    ids = ids.concat(t.rows.map((r) => r.user_id));
  }
  const added = await addMembers(project.id, ids, req.user);
  const full = await loadProject(project.id);
  notify(added, { type: "project", title: `${req.user.name} added you to ${full.name}`, link: `/projects/${full.id}` });
  await audit(req, "project.created", { targetType: "project", targetId: full.id, meta: { key: full.key, name: full.name } });
  res.status(201).json(full);
});

router.get("/:id", async (req, res) => {
  const project = await loadProject(intParam(req.params.id));
  await assertCanSee(req.user, project);
  const members = await query(
    `SELECT u.id, u.name, u.role, u.title, u.avatar_file_id, m.added_at,
       COUNT(t.id) FILTER (WHERE t.status IN ('pending','in_progress'))::int AS open,
       COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS done
     FROM project_members m JOIN users u ON u.id = m.user_id
     LEFT JOIN tasks t ON t.assigned_to = u.id AND t.project_id = m.project_id
     WHERE m.project_id = $1 AND u.is_active
     GROUP BY u.id, m.added_at ORDER BY u.name`,
    [project.id]
  );
  const labels = await query(
    `SELECT l AS label, COUNT(*)::int AS n FROM tasks, unnest(labels) l WHERE project_id = $1 GROUP BY l ORDER BY n DESC LIMIT 30`,
    [project.id]
  );
  res.json({
    ...project,
    can_manage: await canManageProject(req.user, project),
    members: members.rows.map(({ avatar_file_id, ...m }) => ({ ...m, avatar_url: avatarUrl(avatar_file_id) })),
    labels: labels.rows,
  });
});

router.patch("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const project = await loadProject(id);
  if (!(await canManageProject(req.user, project))) throw forbidden("Only this project's managers can change it.");
  const body = parse(projectSchema.partial().extend({ status: z.enum(["active", "archived"]).optional(), owner_id: z.number().int().positive().optional() }), req.body);
  const sent = new Set(Object.keys(req.body || {}));
  const fields = ["key", "name", "description", "kind", "color", "team_id", "goal", "start_date", "end_date", "status", "owner_id"].filter((k) => sent.has(k));
  if (fields.length) {
    try {
      await query(
        `UPDATE projects SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [id, ...fields.map((k) => body[k] ?? null)]
      );
    } catch (err) {
      if (err.code === "23505") throw conflict(`The key ${body.key} is already used.`);
      throw err;
    }
  }
  await audit(req, sent.has("status") ? `project.${body.status === "archived" ? "archived" : "restored"}` : "project.updated", {
    targetType: "project",
    targetId: id,
    meta: { name: project.name, fields },
  });
  res.json(await loadProject(id));
});

router.delete("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  if (!isAdmin(req.user)) throw forbidden("Only admins can delete projects. Managers can archive them.");
  const project = await loadProject(id);
  if (project.task_count > 0) throw conflict(`This project still has ${project.task_count} tasks. Archive it instead, or move/delete its tasks first.`);
  await query(`DELETE FROM projects WHERE id = $1`, [id]);
  await audit(req, "project.deleted", { targetType: "project", targetId: id, meta: { key: project.key, name: project.name } });
  res.json({ ok: true });
});

// ---------- members ----------
router.post("/:id/members", async (req, res) => {
  const id = intParam(req.params.id);
  const project = await loadProject(id);
  if (!(await canManageProject(req.user, project))) throw forbidden("Only this project's managers can add people.");
  const { user_ids, team_id } = parse(
    z.object({ user_ids: z.array(z.number().int().positive()).max(500).default([]), team_id: z.number().int().positive().optional() }),
    req.body
  );
  let ids = user_ids;
  if (team_id) {
    const t = await query(`SELECT user_id FROM team_members WHERE team_id = $1`, [team_id]);
    ids = ids.concat(t.rows.map((r) => r.user_id));
  }
  const added = await addMembers(id, ids, req.user);
  notify(added, { type: "project", title: `${req.user.name} added you to ${project.name}`, link: `/projects/${id}` });
  await audit(req, "project.members_added", { targetType: "project", targetId: id, meta: { name: project.name, count: added.length } });
  res.json({ added: added.length });
});

router.delete("/:id/members/:userId", async (req, res) => {
  const id = intParam(req.params.id);
  const userId = intParam(req.params.userId, "user id");
  const project = await loadProject(id);
  const self = userId === req.user.id;
  if (!self && !(await canManageProject(req.user, project))) throw forbidden("Only this project's managers can remove people.");
  await query(`DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`, [id, userId]);
  leaveProject(userId, id);
  await audit(req, "project.member_removed", { targetType: "project", targetId: id, meta: { name: project.name, user_id: userId } });
  res.json({ ok: true });
});

// ---------- templates & recurring tasks ----------
const templateSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(10_000).nullable().optional(),
  type: z.enum(TYPES).default("other"),
  priority: z.enum(PRIORITIES).default("medium"),
  labels: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]),
  channel: z.string().trim().max(40).nullable().optional(),
  estimate: z.number().int().min(0).max(999).nullable().optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  assignee_id: z.number().int().positive().nullable().optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  due_in_days: z.number().int().min(0).max(365).default(3),
  next_run_on: date,
  active: z.boolean().default(true),
});

router.get("/:id/templates", async (req, res) => {
  const project = await loadProject(intParam(req.params.id));
  await assertCanSee(req.user, project);
  const { rows } = await query(
    `SELECT tt.*, u.name AS assignee_name FROM task_templates tt LEFT JOIN users u ON u.id = tt.assignee_id
     WHERE tt.project_id = $1 ORDER BY tt.title`,
    [project.id]
  );
  res.json(rows);
});

router.post("/:id/templates", async (req, res) => {
  const project = await loadProject(intParam(req.params.id));
  if (!(await canManageProject(req.user, project))) throw forbidden("Only this project's managers can add templates.");
  const b = parse(templateSchema, req.body);
  const next = b.recurrence === "none" ? null : b.next_run_on || nextRunDate(b.recurrence, new Date(), true);
  const { rows } = await query(
    `INSERT INTO task_templates (project_id, title, description, type, priority, labels, channel, estimate, checklist, assignee_id, recurrence, due_in_days, next_run_on, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [project.id, b.title, b.description || null, b.type, b.priority, b.labels, b.channel || null, b.estimate ?? null, JSON.stringify(b.checklist), b.assignee_id || null, b.recurrence, b.due_in_days, next, b.active, req.user.id]
  );
  await audit(req, "template.created", { targetType: "template", targetId: rows[0].id, meta: { title: b.title, recurrence: b.recurrence } });
  res.status(201).json(rows[0]);
});

async function loadTemplate(req) {
  const { rows } = await query(`SELECT * FROM task_templates WHERE id = $1`, [intParam(req.params.tid, "template id")]);
  if (!rows[0]) throw notFound("Template not found");
  const project = await loadProject(rows[0].project_id);
  if (!(await canManageProject(req.user, project))) throw forbidden("Only this project's managers can change templates.");
  return rows[0];
}

router.patch("/:id/templates/:tid", async (req, res) => {
  const tpl = await loadTemplate(req);
  const b = parse(templateSchema.partial(), req.body);
  const sent = new Set(Object.keys(req.body || {}));
  const fields = ["title", "description", "type", "priority", "labels", "channel", "estimate", "checklist", "assignee_id", "recurrence", "due_in_days", "next_run_on", "active"].filter((k) => sent.has(k));
  const values = fields.map((k) => (k === "checklist" ? JSON.stringify(b[k] || []) : b[k] ?? null));
  if (fields.length) {
    await query(`UPDATE task_templates SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [tpl.id, ...values]);
  }
  if (sent.has("recurrence") && b.recurrence !== "none" && !sent.has("next_run_on")) {
    await query(`UPDATE task_templates SET next_run_on = COALESCE(next_run_on, $2) WHERE id = $1`, [tpl.id, nextRunDate(b.recurrence, new Date(), true)]);
  }
  const { rows } = await query(`SELECT * FROM task_templates WHERE id = $1`, [tpl.id]);
  res.json(rows[0]);
});

router.delete("/:id/templates/:tid", async (req, res) => {
  const tpl = await loadTemplate(req);
  await query(`DELETE FROM task_templates WHERE id = $1`, [tpl.id]);
  await audit(req, "template.deleted", { targetType: "template", targetId: tpl.id, meta: { title: tpl.title } });
  res.json({ ok: true });
});

// Create a task from a template right now.
router.post("/:id/templates/:tid/run", async (req, res) => {
  const tpl = await loadTemplate(req);
  const { assignee_id } = parse(z.object({ assignee_id: z.number().int().positive().optional() }), req.body);
  const task = await tx((c) => createTaskFromTemplate(c, { ...tpl, assignee_id: assignee_id || tpl.assignee_id }, req.user));
  if (!task) throw badRequest("Pick someone to assign it to.");
  afterTaskCreated(task, req.user);
  await audit(req, "task.created", { targetType: "task", targetId: task.id, meta: { title: task.title, from_template: tpl.id } });
  res.status(201).json(task);
});

export default router;
