// Background jobs. Runs every few minutes; a Postgres advisory lock makes
// sure only one API instance does the work when you run several.
//  - creates tasks from recurring templates that are due
//  - reminds assignees about tasks due tomorrow, and flags newly overdue ones
//  - deletes old notifications, sign-in records and expired links
//    (the audit log is never purged — it's the tamper-evident record)
import { pool, query } from "../db.js";
import { getSettings } from "./settings.js";
import { createTaskFromTemplate, nextRunDate } from "./templates.js";
import { afterTaskCreated } from "./taskOps.js";
import { notify, reviewerIds } from "./notify.js";
import { emitEvent } from "./webhooks.js";

const LOCK_ID = 727_003;
let timer = null;

async function runTemplates() {
  const { rows } = await query(
    `SELECT tt.*, u.id AS creator_id, u.name AS creator_name FROM task_templates tt
     LEFT JOIN users u ON u.id = tt.created_by
     JOIN projects p ON p.id = tt.project_id AND p.status = 'active'
     WHERE tt.active AND tt.recurrence <> 'none' AND tt.next_run_on IS NOT NULL AND tt.next_run_on <= CURRENT_DATE
     LIMIT 100`
  );
  let created = 0;
  for (const tpl of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const actor = tpl.creator_id ? { id: tpl.creator_id, name: tpl.creator_name } : null;
      const task = await createTaskFromTemplate(client, tpl, actor);
      await client.query(`UPDATE task_templates SET next_run_on = $2 WHERE id = $1`, [tpl.id, nextRunDate(tpl.recurrence, new Date())]);
      await client.query("COMMIT");
      if (task) {
        afterTaskCreated(task, actor);
        created++;
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[scheduler] template", tpl.id, err.message);
    } finally {
      client.release();
    }
  }
  return created;
}

async function runReminders() {
  // Due tomorrow → remind the assignee once.
  const dueSoon = await query(
    `UPDATE tasks SET reminded_on = CURRENT_DATE
     WHERE status IN ('pending','in_progress') AND due_date = CURRENT_DATE + 1
       AND (reminded_on IS NULL OR reminded_on < CURRENT_DATE)
     RETURNING id, title, assigned_to`
  );
  for (const t of dueSoon.rows) {
    notify(t.assigned_to, { type: "task", title: `Due tomorrow: ${t.title}`, link: `/tasks?task=${t.id}`, email: false });
  }
  // Became overdue today → tell the assignee and whoever reviews it.
  const overdue = await query(
    `UPDATE tasks SET reminded_on = CURRENT_DATE
     WHERE status <> 'completed' AND due_date = CURRENT_DATE - 1
       AND (reminded_on IS NULL OR reminded_on < CURRENT_DATE)
     RETURNING id`
  );
  for (const { id } of overdue.rows) {
    const { rows } = await query(
      `SELECT t.*, u.name AS assignee_name, p.key || '-' || t.number AS key FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = $1`,
      [id]
    );
    const t = rows[0];
    if (!t) continue;
    notify([t.assigned_to, ...(await reviewerIds(t))], { type: "task", title: `Overdue: ${t.title}`, link: `/tasks?task=${id}`, email: false });
    emitEvent("task.overdue", { task: t }, { projectId: t.project_id });
  }
  return dueSoon.rowCount + overdue.rowCount;
}

async function runRetention() {
  const { retention_days } = await getSettings();
  const days = String(Math.max(30, Number(retention_days) || 180));
  await query(`DELETE FROM notifications WHERE created_at < now() - ($1 || ' days')::interval`, [days]);
  await query(`DELETE FROM login_logs WHERE login_at < now() - ($1 || ' days')::interval`, [days]);
  await query(`DELETE FROM blocked_uploads WHERE created_at < now() - ($1 || ' days')::interval`, [days]);
  await query(`DELETE FROM auth_tokens WHERE expires_at < now() - interval '1 day'`);
}

export async function runJobsOnce() {
  const client = await pool.connect();
  let locked = false;
  try {
    const r = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID]);
    locked = r.rows[0].ok;
    if (!locked) return { skipped: true };
    const created = await runTemplates();
    const reminded = await runReminders();
    await runRetention();
    return { created, reminded };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}

export function startScheduler(intervalMs = Number(process.env.JOB_INTERVAL_MS) || 5 * 60 * 1000) {
  if (process.env.DISABLE_JOBS === "true") return;
  const tick = () => runJobsOnce().catch((err) => console.error("[scheduler]", err.message));
  setTimeout(tick, 10_000).unref();
  timer = setInterval(tick, intervalMs);
  timer.unref();
}

export const stopScheduler = () => timer && clearInterval(timer);
