import express from "express";
import { z } from "zod";
import { query, tx } from "../db.js";
import { parse, intParam, badRequest, forbidden, notFound, conflict } from "../lib/http.js";
import { shieldUpload, publicFile, deleteStoredFiles } from "../lib/fileShield.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { reviewerIds } from "../lib/notify.js";
import { taskChanged } from "../lib/realtime.js";
import { emitEvent } from "../lib/webhooks.js";
import { TYPES, PRIORITIES, STATUSES, linkKind, normalizeLabels } from "../lib/constants.js";
import { TASK_SELECT, loadTaskRow, insertTask, afterTaskCreated, allocateNumber } from "../lib/taskOps.js";
import { canLead, isAdmin, taskVisibility, canSeeTask, canManageTask, isProjectMember } from "../lib/access.js";

export { TYPES, PRIORITIES, STATUSES };
const router = express.Router();

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const taskSchema = z.object({
  title: z.string().trim().min(3, "Title is too short").max(200),
  description: z.string().trim().max(20_000).optional().nullable(),
  assigned_to: z.coerce.number().int().positive("Pick someone to assign this to"),
  due_date: dateString,
  start_date: dateString,
  type: z.enum(TYPES).default("other"),
  priority: z.enum(PRIORITIES).default("medium"),
  project_id: z.coerce.number().int().positive().nullable().optional(),
  labels: z.array(z.string().max(40)).max(10).optional(),
  estimate: z.coerce.number().int().min(0).max(999).nullable().optional(),
  channel: z.string().trim().max(40).nullable().optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
});

const short = (t) => (t.key ? `${t.key} ${t.title}` : t.title);

async function loadTask(id) {
  const t = await loadTaskRow(id);
  if (!t) throw notFound("Task not found");
  return t;
}

async function assertCanSee(req, task) {
  if (!(await canSeeTask(req.user, task))) throw forbidden("You don't have access to this task.");
}
async function assertCanManage(req, task) {
  if (!(await canManageTask(req.user, task))) throw forbidden("Only admins and this project's managers can do that.");
}

async function assertAssignable(req, userId, projectId) {
  const { rows } = await query(`SELECT id, name, role, is_active FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u || !u.is_active) throw badRequest("That person doesn't exist or is disabled.");
  if (projectId) {
    const p = await query(`SELECT id, status, owner_id FROM projects WHERE id = $1`, [projectId]);
    if (!p.rows[0]) throw badRequest("That project doesn't exist.");
    if (p.rows[0].status === "archived") throw badRequest("That project is archived.");
    if (!isAdmin(req.user) && !(await isProjectMember(req.user.id, projectId))) throw forbidden("You can only add tasks to projects you're on.");
  }
  return u;
}

// ---------- list ----------
const listSchema = z.object({
  status: z.enum([...STATUSES, "open", "all"]).optional(),
  assignee: z.union([z.coerce.number().int().positive(), z.literal("me")]).optional(),
  project: z.union([z.coerce.number().int().positive(), z.literal("none")]).optional(),
  type: z.enum(TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  label: z.string().trim().max(40).optional(),
  channel: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  due_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

router.get("/", async (req, res) => {
  const f = parse(listSchema, req.query);
  const params = [];
  const where = [taskVisibility(req.user, params)];
  const add = (sql, ...values) => {
    let out = sql;
    for (const v of values) {
      params.push(v);
      out = out.replace("?", `$${params.length}`);
    }
    where.push(out);
  };

  if (f.assignee === "me") add("t.assigned_to = ?", req.user.id);
  else if (f.assignee) add("t.assigned_to = ?", f.assignee);
  if (f.project === "none") where.push("t.project_id IS NULL");
  else if (f.project) add("t.project_id = ?", f.project);
  if (f.status === "open") where.push("t.status <> 'completed'");
  else if (f.status && f.status !== "all") add("t.status = ?", f.status);
  if (f.type) add("t.type = ?", f.type);
  if (f.priority) add("t.priority = ?", f.priority);
  if (f.label) add("? = ANY(t.labels)", f.label.toLowerCase());
  if (f.channel) add("t.channel = ?", f.channel);
  if (f.q) {
    const m = f.q.match(/^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/);
    if (m) add("(p.key = ? AND t.number = ?)", m[1].toUpperCase(), Number(m[2]));
    else add("(t.title ILIKE ? OR t.description ILIKE ?)", `%${f.q}%`, `%${f.q}%`);
  }
  if (f.overdue === "true") where.push("t.status <> 'completed' AND t.due_date < CURRENT_DATE");
  if (f.due_from) add("t.due_date >= ?", f.due_from);
  if (f.due_to) add("t.due_date <= ?", f.due_to);
  params.push(f.limit);

  const { rows } = await query(
    `${TASK_SELECT}
     WHERE ${where.join(" AND ")}
     ORDER BY
       CASE t.status WHEN 'in_review' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       t.due_date ASC NULLS LAST,
       t.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(rows.map(({ assignee_avatar, ...t }) => ({ ...t, assignee_avatar_url: assignee_avatar ? `/avatars/${assignee_avatar}` : null })));
});

// ---------- labels in use (for pickers) ----------
router.get("/labels", async (req, res) => {
  const params = [];
  const vis = taskVisibility(req.user, params);
  const { rows } = await query(
    `SELECT l AS label, COUNT(*)::int AS n FROM tasks t, unnest(t.labels) l WHERE ${vis} GROUP BY l ORDER BY n DESC, l LIMIT 100`,
    params
  );
  res.json(rows);
});

// ---------- bulk actions ----------
const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  action: z.enum(["priority", "assign", "due_date", "add_label", "remove_label", "move_project", "close", "delete"]),
  value: z.any().optional(),
});

router.post("/bulk", async (req, res) => {
  if (!canLead(req.user)) throw forbidden("Only admins and managers can change tasks in bulk.");
  const { ids, action, value } = parse(bulkSchema, req.body);
  const done = [];
  const skipped = [];
  for (const id of ids) {
    const task = await loadTaskRow(id);
    if (!task || !(await canManageTask(req.user, task))) {
      skipped.push(id);
      continue;
    }
    if (action === "priority") {
      if (!PRIORITIES.includes(value)) throw badRequest("Pick a priority.");
      await query(`UPDATE tasks SET priority = $2, updated_at = now() WHERE id = $1`, [id, value]);
    } else if (action === "assign") {
      const u = await assertAssignable(req, Number(value), task.project_id);
      await query(`UPDATE tasks SET assigned_to = $2, updated_at = now() WHERE id = $1`, [id, u.id]);
      if (task.project_id) await query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.project_id, u.id]);
      if (u.id !== task.assigned_to) notify(u.id, { type: "task", title: `Task assigned to you: ${short(task)}`, link: `/tasks?task=${id}` });
    } else if (action === "due_date") {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest("Use YYYY-MM-DD.");
      await query(`UPDATE tasks SET due_date = $2, updated_at = now() WHERE id = $1`, [id, value || null]);
    } else if (action === "add_label" || action === "remove_label") {
      const [label] = normalizeLabels([String(value || "")]);
      if (!label) throw badRequest("Type a label.");
      await query(
        action === "add_label"
          ? `UPDATE tasks SET labels = CASE WHEN $2 = ANY(labels) OR cardinality(labels) >= 10 THEN labels ELSE array_append(labels, $2) END, updated_at = now() WHERE id = $1`
          : `UPDATE tasks SET labels = array_remove(labels, $2), updated_at = now() WHERE id = $1`,
        [id, label]
      );
    } else if (action === "move_project") {
      const pid = value ? Number(value) : null;
      if (pid) await assertAssignable(req, task.assigned_to, pid);
      await tx(async (c) => {
        const number = await allocateNumber(c, pid);
        await c.query(`UPDATE tasks SET project_id = $2, number = $3, updated_at = now() WHERE id = $1`, [id, pid, number]);
        if (pid && task.assigned_to) await c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [pid, task.assigned_to]);
      });
    } else if (action === "close") {
      await query(`UPDATE tasks SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = $1`, [id]);
    } else if (action === "delete") {
      await deleteTask(id);
    }
    done.push(id);
    taskChanged(task);
  }
  await audit(req, "task.bulk", { meta: { action, value: value ?? null, count: done.length, ids: done } });
  res.json({ updated: done.length, skipped: skipped.length });
});

// ---------- detail ----------
router.get("/:id", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanSee(req, task);
  const [subs, checklist, links, deps, blocking] = await Promise.all([
    query(
      `SELECT s.id, s.notes, s.submitted_at, s.review_status, s.review_note, s.reviewed_at,
              s.file_name AS legacy_file_name, (s.file_path IS NOT NULL) AS has_legacy_file,
              u.name AS submitted_by_name, r.name AS reviewed_by_name, row_to_json(f) AS file
       FROM task_submissions s
       LEFT JOIN users u ON u.id = s.submitted_by
       LEFT JOIN users r ON r.id = s.reviewed_by
       LEFT JOIN files f ON f.id = s.file_id
       WHERE s.task_id = $1 ORDER BY s.submitted_at DESC`,
      [task.id]
    ),
    query(`SELECT id, text, done, position, done_at FROM task_checklist WHERE task_id = $1 ORDER BY position, id`, [task.id]),
    query(`SELECT l.id, l.url, l.title, l.kind, l.created_at, u.name AS added_by_name FROM task_links l LEFT JOIN users u ON u.id = l.added_by WHERE l.task_id = $1 ORDER BY l.id`, [task.id]),
    query(
      `SELECT x.id, x.title, x.status, x.number, p.key AS project_key FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id
       LEFT JOIN projects p ON p.id = x.project_id WHERE d.task_id = $1 ORDER BY x.id`,
      [task.id]
    ),
    query(
      `SELECT x.id, x.title, x.status, x.number, p.key AS project_key FROM task_dependencies d JOIN tasks x ON x.id = d.task_id
       LEFT JOIN projects p ON p.id = x.project_id WHERE d.depends_on_id = $1 ORDER BY x.id`,
      [task.id]
    ),
  ]);
  const ref = (r) => ({ id: r.id, title: r.title, status: r.status, key: r.project_key && r.number ? `${r.project_key}-${r.number}` : null });
  res.json({
    ...task,
    can_manage: await canManageTask(req.user, task),
    submissions: subs.rows.map((s) => ({ ...s, file: publicFile(s.file) })),
    checklist: checklist.rows,
    links: links.rows,
    depends_on: deps.rows.map(ref),
    blocks: blocking.rows.map(ref),
  });
});

router.get("/:id/history", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanSee(req, task);
  const { rows } = await query(
    `SELECT id, actor_name, action, meta, created_at FROM audit_log
     WHERE target_type = 'task' AND target_id = $1 ORDER BY id DESC LIMIT 100`,
    [String(task.id)]
  );
  res.json(rows);
});

// ---------- create / edit / delete ----------
router.post("/", async (req, res) => {
  if (!canLead(req.user)) throw forbidden("Only admins and managers can create tasks.");
  const body = parse(taskSchema, req.body);
  await assertAssignable(req, body.assigned_to, body.project_id);
  const id = await tx((c) => insertTask(c, body, req.user));
  const task = await loadTask(id);
  await audit(req, "task.created", { targetType: "task", targetId: task.id, meta: { title: short(task), assigned_to: task.assignee_name } });
  afterTaskCreated(task, req.user);
  res.status(201).json(task);
});

router.post("/:id/duplicate", async (req, res) => {
  const src = await loadTask(intParam(req.params.id));
  await assertCanManage(req, src);
  const checklist = await query(`SELECT text FROM task_checklist WHERE task_id = $1 ORDER BY position, id`, [src.id]);
  const id = await tx((c) =>
    insertTask(c, { ...src, title: `${src.title} (copy)`.slice(0, 200), checklist: checklist.rows.map((r) => r.text) }, req.user)
  );
  const task = await loadTask(id);
  await audit(req, "task.created", { targetType: "task", targetId: id, meta: { title: short(task), duplicated_from: src.id } });
  afterTaskCreated(task, req.user);
  res.status(201).json(task);
});

const EDITABLE = ["title", "description", "assigned_to", "due_date", "start_date", "type", "priority", "project_id", "labels", "estimate", "channel"];

router.patch("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const before = await loadTask(id);
  await assertCanManage(req, before);
  const body = parse(taskSchema.partial(), req.body);
  const sent = new Set(Object.keys(req.body || {}));
  const fields = EDITABLE.filter((k) => sent.has(k) && k in body);
  if (fields.length === 0) return res.json(before);

  const projectId = sent.has("project_id") ? body.project_id || null : before.project_id;
  if (sent.has("assigned_to") || sent.has("project_id")) await assertAssignable(req, body.assigned_to || before.assigned_to, projectId);

  await tx(async (c) => {
    const values = fields.map((k) => (k === "labels" ? normalizeLabels(body.labels || []) : body[k] ?? null));
    await c.query(`UPDATE tasks SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...values]);
    if (sent.has("project_id") && (body.project_id || null) !== before.project_id) {
      await c.query(`UPDATE tasks SET number = $2 WHERE id = $1`, [id, await allocateNumber(c, projectId)]);
    }
    const assignee = body.assigned_to || before.assigned_to;
    if (projectId && assignee) await c.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [projectId, assignee]);
  });
  const task = await loadTask(id);

  const changes = Object.fromEntries(
    fields.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(task[k] ?? null)).map((k) => [k, { from: before[k], to: task[k] }])
  );
  await audit(req, "task.updated", { targetType: "task", targetId: id, meta: { title: short(task), changes } });

  if (changes.assigned_to) {
    notify(task.assigned_to, { type: "task", title: `Task assigned to you: ${short(task)}`, link: `/tasks?task=${id}` });
    if (before.assigned_to) notify(before.assigned_to, { type: "task", title: `Task reassigned away from you: ${short(task)}`, email: false });
    taskChanged(before);
  } else if (Object.keys(changes).length && task.assigned_to !== req.user.id) {
    notify(task.assigned_to, {
      type: "task_update",
      title: `Task updated: ${short(task)}`,
      body: `Changed: ${Object.keys(changes).join(", ").replace(/_/g, " ")}`,
      link: `/tasks?task=${id}`,
    });
  }
  taskChanged(task);
  res.json(task);
});

async function deleteTask(id) {
  const files = await tx(async (c) => {
    const f = await c.query(
      `SELECT f.id, f.storage_key, s.file_path FROM task_submissions s
       LEFT JOIN files f ON f.id = s.file_id WHERE s.task_id = $1`,
      [id]
    );
    await c.query(`DELETE FROM tasks WHERE id = $1`, [id]);
    const ids = f.rows.map((r) => r.id).filter(Boolean);
    if (ids.length) await c.query(`DELETE FROM files WHERE id = ANY($1::uuid[])`, [ids]);
    return f.rows;
  });
  await deleteStoredFiles(files);
}

router.delete("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const task = await loadTask(id);
  await assertCanManage(req, task);
  await deleteTask(id);
  await audit(req, "task.deleted", { targetType: "task", targetId: id, meta: { title: short(task) } });
  taskChanged(task);
  res.json({ ok: true });
});

// ---------- workflow ----------
// pending → in_progress → in_review → completed
//                ↑______________| (changes requested)
router.post("/:id/start", async (req, res) => {
  const id = intParam(req.params.id);
  const task = await loadTask(id);
  if (task.assigned_to !== req.user.id && !(await canManageTask(req.user, task))) throw forbidden("Only the assignee can start this task.");
  if (task.status !== "pending") throw conflict(`Task is already ${task.status.replace("_", " ")}.`);
  await query(`UPDATE tasks SET status = 'in_progress', updated_at = now() WHERE id = $1`, [id]);
  await audit(req, "task.started", { targetType: "task", targetId: id, meta: { title: short(task) } });
  const fresh = await loadTask(id);
  taskChanged(fresh);
  res.json(fresh);
});

const submitSchema = z.object({ notes: z.string().trim().max(20_000).optional() });

router.post("/:id/submit", shieldUpload("file", "submission"), async (req, res) => {
  const id = intParam(req.params.id);
  const task = await loadTask(id);
  const file = req.shieldedFile;
  try {
    if (task.assigned_to !== req.user.id) throw forbidden("Only the assignee can submit this task.");
    if (!["in_progress", "pending"].includes(task.status)) {
      throw conflict(task.status === "in_review" ? "Already submitted — waiting for review." : "This task is already completed.");
    }
    const { notes } = parse(submitSchema, req.body);
    if (!notes && !file) throw badRequest("Add notes, a file, or both.");
    await tx(async (c) => {
      await c.query(
        `INSERT INTO task_submissions (task_id, submitted_by, notes, file_id, file_name) VALUES ($1,$2,$3,$4,$5)`,
        [id, req.user.id, notes || null, file?.id || null, file?.original_name || null]
      );
      await c.query(`UPDATE tasks SET status = 'in_review', updated_at = now() WHERE id = $1`, [id]);
    });
  } catch (err) {
    if (file) {
      await query(`DELETE FROM files WHERE id = $1`, [file.id]).catch(() => {});
      await deleteStoredFiles([file]);
    }
    throw err;
  }

  await audit(req, "task.submitted", {
    targetType: "task",
    targetId: id,
    meta: { title: short(task), file: file ? { name: file.original_name, sha256: file.sha256, risk: file.risk_level } : null },
  });
  notify(await reviewerIds(task), {
    type: "review",
    title: `${req.user.name} submitted ${short(task)} for review`,
    body: file ? `Attached: ${file.original_name}${file.risk_level === "warn" ? " (File Shield warning)" : ""}` : null,
    link: `/tasks?task=${id}`,
  });
  const fresh = await loadTask(id);
  emitEvent("task.submitted", { actor: { id: req.user.id, name: req.user.name }, task: fresh }, { projectId: fresh.project_id });
  taskChanged(fresh);
  res.status(201).json(fresh);
});

const reviewSchema = z.object({
  decision: z.enum(["approve", "changes"]),
  note: z.string().trim().max(5000).optional(),
});

router.post("/:id/review", async (req, res) => {
  const id = intParam(req.params.id);
  const { decision, note } = parse(reviewSchema, req.body);
  const task = await loadTask(id);
  await assertCanManage(req, task);
  if (task.status !== "in_review") throw conflict("Only tasks waiting for review can be reviewed.");
  if (decision === "changes" && !note) throw badRequest("Tell them what needs to change.", { field: "note" });

  await tx(async (c) => {
    await c.query(
      `UPDATE task_submissions SET review_status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = (SELECT id FROM task_submissions WHERE task_id = $1 ORDER BY submitted_at DESC LIMIT 1)`,
      [id, decision === "approve" ? "approved" : "changes_requested", note || null, req.user.id]
    );
    await c.query(
      `UPDATE tasks SET status = $2::varchar, completed_at = CASE WHEN $2::varchar = 'completed' THEN now() ELSE NULL END, updated_at = now()
       WHERE id = $1`,
      [id, decision === "approve" ? "completed" : "in_progress"]
    );
  });

  await audit(req, decision === "approve" ? "task.approved" : "task.changes_requested", {
    targetType: "task",
    targetId: id,
    meta: { title: short(task), note: note || null },
  });
  notify(task.assigned_to, {
    type: "review",
    title: decision === "approve" ? `Approved: ${short(task)}` : `Changes requested: ${short(task)}`,
    body: note || null,
    link: `/tasks?task=${id}`,
  });
  const fresh = await loadTask(id);
  emitEvent(decision === "approve" ? "task.approved" : "task.changes_requested", { actor: { id: req.user.id, name: req.user.name }, task: fresh, note }, { projectId: fresh.project_id });
  taskChanged(fresh);
  res.json(fresh);
});

router.post("/:id/reopen", async (req, res) => {
  const id = intParam(req.params.id);
  const task = await loadTask(id);
  await assertCanManage(req, task);
  if (task.status !== "completed") throw conflict("Only completed tasks can be reopened.");
  await query(`UPDATE tasks SET status = 'in_progress', completed_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  await audit(req, "task.reopened", { targetType: "task", targetId: id, meta: { title: short(task) } });
  notify(task.assigned_to, { type: "task", title: `Reopened: ${short(task)}`, link: `/tasks?task=${id}` });
  const fresh = await loadTask(id);
  taskChanged(fresh);
  res.json(fresh);
});

// ---------- checklist (subtasks) ----------
async function canWork(req, task) {
  if (task.assigned_to === req.user.id) return;
  await assertCanManage(req, task);
}

router.post("/:id/checklist", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await canWork(req, task);
  const { text } = parse(z.object({ text: z.string().trim().min(1, "Write something").max(300) }), req.body);
  const count = await query(`SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1) AS p FROM task_checklist WHERE task_id = $1`, [task.id]);
  if (count.rows[0].n >= 50) throw badRequest("A checklist can have up to 50 items. Split the task instead.");
  const { rows } = await query(`INSERT INTO task_checklist (task_id, text, position) VALUES ($1,$2,$3) RETURNING *`, [task.id, text, count.rows[0].p + 1]);
  taskChanged(task);
  res.status(201).json(rows[0]);
});

router.patch("/:id/checklist/:itemId", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await canWork(req, task);
  const b = parse(z.object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional(), position: z.number().int().min(0).max(1000).optional() }), req.body);
  const { rows } = await query(
    `UPDATE task_checklist SET
       text = COALESCE($3, text),
       position = COALESCE($5, position),
       done = COALESCE($4, done),
       done_by = CASE WHEN $4::boolean IS TRUE THEN $6 WHEN $4::boolean IS FALSE THEN NULL ELSE done_by END,
       done_at = CASE WHEN $4::boolean IS TRUE THEN now() WHEN $4::boolean IS FALSE THEN NULL ELSE done_at END
     WHERE id = $1 AND task_id = $2 RETURNING *`,
    [intParam(req.params.itemId, "item id"), task.id, b.text ?? null, b.done ?? null, b.position ?? null, req.user.id]
  );
  if (!rows[0]) throw notFound("Checklist item not found");
  taskChanged(task);
  res.json(rows[0]);
});

router.delete("/:id/checklist/:itemId", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await canWork(req, task);
  await query(`DELETE FROM task_checklist WHERE id = $1 AND task_id = $2`, [intParam(req.params.itemId, "item id"), task.id]);
  taskChanged(task);
  res.json({ ok: true });
});

// ---------- links (PRs, designs, docs) ----------
router.post("/:id/links", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanSee(req, task);
  const b = parse(
    z.object({
      url: z.string().trim().url("Paste a full link starting with https://").max(2000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
      title: z.string().trim().max(200).optional(),
    }),
    req.body
  );
  const count = await query(`SELECT COUNT(*)::int AS n FROM task_links WHERE task_id = $1`, [task.id]);
  if (count.rows[0].n >= 30) throw badRequest("This task already has 30 links.");
  const { rows } = await query(
    `INSERT INTO task_links (task_id, url, title, kind, added_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [task.id, b.url, b.title || null, linkKind(b.url), req.user.id]
  );
  await audit(req, "task.link_added", { targetType: "task", targetId: task.id, meta: { title: short(task), url: b.url } });
  taskChanged(task);
  res.status(201).json(rows[0]);
});

router.delete("/:id/links/:linkId", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  const { rows } = await query(`SELECT * FROM task_links WHERE id = $1 AND task_id = $2`, [intParam(req.params.linkId, "link id"), task.id]);
  if (!rows[0]) throw notFound("Link not found");
  if (rows[0].added_by !== req.user.id) await assertCanManage(req, task);
  await query(`DELETE FROM task_links WHERE id = $1`, [rows[0].id]);
  taskChanged(task);
  res.json({ ok: true });
});

// ---------- dependencies ----------
router.post("/:id/dependencies", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanManage(req, task);
  const { depends_on } = parse(z.object({ depends_on: z.union([z.number().int().positive(), z.string().trim().max(20)]) }), req.body);
  let otherId = typeof depends_on === "number" ? depends_on : null;
  if (!otherId) {
    const m = String(depends_on).match(/^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/);
    if (!m) throw badRequest("Use a task key like WEB-12.");
    const r = await query(`SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.key = $1 AND t.number = $2`, [m[1].toUpperCase(), Number(m[2])]);
    otherId = r.rows[0]?.id;
  }
  if (!otherId) throw notFound("No task with that key.");
  if (otherId === task.id) throw badRequest("A task can't depend on itself.");
  const other = await loadTask(otherId);
  await assertCanSee(req, other);
  // Refuse cycles: does `other` (transitively) depend on `task`?
  const cycle = await query(
    `WITH RECURSIVE chain(id) AS (
       SELECT depends_on_id FROM task_dependencies WHERE task_id = $1
       UNION SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
     ) SELECT 1 FROM chain WHERE id = $2 LIMIT 1`,
    [other.id, task.id]
  );
  if (cycle.rows.length) throw conflict("That would create a loop of tasks waiting on each other.");
  await query(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [task.id, other.id]);
  await audit(req, "task.dependency_added", { targetType: "task", targetId: task.id, meta: { title: short(task), depends_on: short(other) } });
  taskChanged(task);
  res.status(201).json({ ok: true });
});

router.delete("/:id/dependencies/:otherId", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanManage(req, task);
  await query(`DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2`, [task.id, intParam(req.params.otherId)]);
  taskChanged(task);
  res.json({ ok: true });
});

// ---------- comments with @mentions ----------
router.get("/:id/comments", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanSee(req, task);
  const { rows } = await query(
    `SELECT c.id, c.message, c.created_at, c.user_id, u.name AS author_name, u.role AS author_role, u.avatar_file_id
     FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
    [task.id]
  );
  res.json(rows.map(({ avatar_file_id, ...c }) => ({ ...c, author_avatar_url: avatar_file_id ? `/avatars/${avatar_file_id}` : null })));
});

const commentSchema = z.object({
  message: z.string().trim().min(1, "Write something first").max(4000),
  mentions: z.array(z.number().int().positive()).max(20).optional(),
});

router.post("/:id/comments", async (req, res) => {
  const task = await loadTask(intParam(req.params.id));
  await assertCanSee(req, task);
  const { message, mentions = [] } = parse(commentSchema, req.body);
  const { rows } = await query(
    `INSERT INTO task_comments (task_id, user_id, message) VALUES ($1,$2,$3) RETURNING id, message, created_at, user_id`,
    [task.id, req.user.id, message]
  );
  const comment = { ...rows[0], author_name: req.user.name, author_role: req.user.role };
  const preview = message.length > 140 ? `${message.slice(0, 137)}…` : message;
  const link = `/tasks?task=${task.id}`;

  // Mentioned people who can actually see the task.
  const mentioned = [];
  for (const uid of [...new Set(mentions)]) {
    if (uid === req.user.id) continue;
    const u = await query(`SELECT ${"id, role, is_active"} FROM users WHERE id = $1`, [uid]);
    if (u.rows[0]?.is_active && (await canSeeTask(u.rows[0], task))) mentioned.push(uid);
  }
  notify(mentioned, { type: "mention", title: `${req.user.name} mentioned you on ${short(task)}`, body: preview, link });

  // Everyone else involved hears about it in-app only.
  const involved = new Set([task.assigned_to, ...(await reviewerIds(task))]);
  involved.delete(req.user.id);
  mentioned.forEach((m) => involved.delete(m));
  notify([...involved], { type: "comment", title: `${req.user.name} commented on ${short(task)}`, body: preview, link });

  emitEvent("comment.created", { actor: { id: req.user.id, name: req.user.name }, task, comment: preview }, { projectId: task.project_id });
  taskChanged(task);
  res.status(201).json(comment);
});

export default router;
