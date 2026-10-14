// Task templates and recurring tasks (weekly newsletter, monthly report,
// daily stand-up notes…).
import { insertTask, loadTaskRow } from "./taskOps.js";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Next run date after `from`. With includeToday, today counts as the first run.
export function nextRunDate(recurrence, from = new Date(), includeToday = false) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (includeToday) return iso(d);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "monthly") {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  } else return null;
  return iso(d);
}

export async function createTaskFromTemplate(c, tpl, actor) {
  if (!tpl.assignee_id) return null;
  const due = new Date();
  due.setDate(due.getDate() + (tpl.due_in_days ?? 3));
  const id = await insertTask(
    c,
    {
      title: tpl.title,
      description: tpl.description,
      assigned_to: tpl.assignee_id,
      due_date: iso(due),
      type: tpl.type,
      priority: tpl.priority,
      project_id: tpl.project_id,
      labels: tpl.labels,
      estimate: tpl.estimate,
      channel: tpl.channel,
      checklist: tpl.checklist,
      template_id: tpl.id,
    },
    actor
  );
  // Caller runs afterTaskCreated() once the transaction has committed.
  return loadTaskRow(id, c);
}
