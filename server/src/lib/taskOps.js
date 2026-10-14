// Shared task creation used by the API, templates and the scheduler.
import { query } from "../db.js";
import { normalizeLabels } from "./constants.js";
import { notify } from "./notify.js";
import { taskChanged, joinProject } from "./realtime.js";
import { emitEvent } from "./webhooks.js";

export const TASK_SELECT = `
  SELECT t.*, a.name AS assignee_name, a.avatar_file_id AS assignee_avatar, b.name AS assigned_by_name,
    p.key AS project_key, p.name AS project_name, p.color AS project_color, p.kind AS project_kind,
    CASE WHEN p.key IS NOT NULL AND t.number IS NOT NULL THEN p.key || '-' || t.number END AS key,
    (SELECT COUNT(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
    (SELECT COUNT(*)::int FROM task_submissions s WHERE s.task_id = t.id) AS submission_count,
    (SELECT COUNT(*)::int FROM task_checklist k WHERE k.task_id = t.id) AS checklist_total,
    (SELECT COUNT(*)::int FROM task_checklist k WHERE k.task_id = t.id AND k.done) AS checklist_done,
    (SELECT COUNT(*)::int FROM task_links l WHERE l.task_id = t.id) AS link_count,
    EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks x ON x.id = d.depends_on_id
            WHERE d.task_id = t.id AND x.status <> 'completed') AS is_blocked,
    EXISTS (SELECT 1 FROM task_submissions s WHERE s.task_id = t.id AND (s.file_id IS NOT NULL OR s.file_path IS NOT NULL)) AS has_attachment,
    (t.status <> 'completed' AND t.due_date < CURRENT_DATE) AS is_overdue
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users b ON b.id = t.assigned_by
  LEFT JOIN projects p ON p.id = t.project_id`;

export async function loadTaskRow(id, db = { query }) {
  const { rows } = await db.query(`${TASK_SELECT} WHERE t.id = $1`, [id]);
  const t = rows[0];
  if (!t) return null;
  t.assignee_avatar_url = t.assignee_avatar ? `/avatars/${t.assignee_avatar}` : null;
  delete t.assignee_avatar;
  return t;
}

export async function allocateNumber(c, projectId) {
  if (!projectId) return null;
  const { rows } = await c.query(
    `UPDATE projects SET next_number = next_number + 1, updated_at = now() WHERE id = $1 RETURNING next_number - 1 AS n`,
    [projectId]
  );
  return rows[0]?.n ?? null;
}

// `c` is a client inside a transaction.
export async function insertTask(c, data, actor) {
  const number = await allocateNumber(c, data.project_id);
  const { rows } = await c.query(
    `INSERT INTO tasks (title, description, assigned_to, assigned_by, due_date, start_date, type, priority,
       project_id, number, labels, estimate, channel, template_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      data.title,
      data.description || null,
      data.assigned_to,
      actor?.id || null,
      data.due_date || null,
      data.start_date || null,
      data.type || "other",
      data.priority || "medium",
      data.project_id || null,
      number,
      normalizeLabels(data.labels || []),
      data.estimate ?? null,
      data.channel || null,
      data.template_id || null,
    ]
  );
  const id = rows[0].id;
  const items = (data.checklist || []).filter(Boolean).slice(0, 50);
  for (let i = 0; i < items.length; i++) {
    await c.query(`INSERT INTO task_checklist (task_id, text, position) VALUES ($1,$2,$3)`, [id, items[i], i]);
  }
  if (data.project_id && data.assigned_to) {
    const added = await c.query(
      `INSERT INTO project_members (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING user_id`,
      [data.project_id, data.assigned_to]
    );
    if (added.rows[0]) joinProject(data.assigned_to, data.project_id);
  }
  return id;
}

export function afterTaskCreated(task, actor) {
  if (task.assigned_to && task.assigned_to !== actor?.id) {
    notify(task.assigned_to, {
      type: "task",
      title: `New ${task.priority === "urgent" ? "URGENT " : ""}task${task.key ? ` ${task.key}` : ""}: ${task.title}`,
      body: [task.project_name, task.due_date ? `Due ${task.due_date}` : null].filter(Boolean).join(" · ") || null,
      link: `/tasks?task=${task.id}`,
    });
  }
  emitEvent("task.created", { actor: actor ? { id: actor.id, name: actor.name } : null, task }, { projectId: task.project_id });
  taskChanged(task);
}
