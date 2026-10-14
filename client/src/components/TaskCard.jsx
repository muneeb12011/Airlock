import { MessageSquare, Paperclip, Ban, Link2 } from "lucide-react";
import { Avatar, Due, Labels, Priority, TaskKey } from "./ui";
import { TYPES } from "../lib/format";

export function ChecklistMeter({ task }) {
  if (!task.checklist_total) return null;
  return (
    <span className="checkmeter" title={`${task.checklist_done} of ${task.checklist_total} checklist items done`}>
      <span className="meter"><i style={{ width: `${(task.checklist_done / task.checklist_total) * 100}%`, background: "var(--seal)" }} /></span>
      {task.checklist_done}/{task.checklist_total}
    </span>
  );
}

export default function TaskCard({ task, onOpen, showAssignee = false }) {
  const flag = task.status === "in_review" ? "flag-review" : task.is_overdue ? "flag-overdue" : "";
  return (
    <button type="button" className={`card ${flag}`} onClick={() => onOpen(task.id)}>
      <span className="row gap-8" style={{ justifyContent: "space-between" }}>
        <TaskKey task={task} />
        {task.is_blocked && task.status !== "completed" && <span className="blocked-tag"><Ban size={12} /> Blocked</span>}
      </span>
      <span className="title">{task.title}</span>
      <span className="row wrap gap-12">
        <Priority value={task.priority} />
        <span className="tag">{task.channel || TYPES[task.type] || task.type}</span>
        {task.estimate != null && <span className="tag">{task.estimate} pts</span>}
      </span>
      {task.labels?.length > 0 && <Labels labels={task.labels} max={3} />}
      <span className="row between">
        <span className="row gap-12">
          <Due date={task.due_date} status={task.status} />
          <ChecklistMeter task={task} />
          {task.comment_count > 0 && <span className="tag row gap-4"><MessageSquare size={13} />{task.comment_count}</span>}
          {task.link_count > 0 && <Link2 size={13} color="var(--faint)" aria-label="Has links" />}
          {task.has_attachment && <Paperclip size={13} color="var(--faint)" aria-label="Has attachment" />}
        </span>
        {showAssignee && task.assignee_name && <Avatar name={task.assignee_name} id={task.assigned_to} src={task.assignee_avatar_url} size="sm" />}
      </span>
    </button>
  );
}
