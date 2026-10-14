import { useEffect, useMemo, useState } from "react";
import api from "../api";
import useAuth from "../store/auth";
import useWorkspace from "../store/workspace";
import { errorMessage } from "../lib/download";
import { TYPES, PRIORITIES, isoDate } from "../lib/format";
import { Button, Callout, Field, Modal } from "./ui";
import ChipInput from "./ChipInput";

const MARKETING_TYPES = ["content", "campaign"];

export default function TaskForm({ task, defaults = {}, onClose, onSaved }) {
  const settings = useAuth((s) => s.settings);
  const { people, projects, labels, loadPeople, loadProjects, loadLabels } = useWorkspace();
  useEffect(() => {
    loadPeople().catch(() => {});
    loadProjects().catch(() => {});
    loadLabels().catch(() => {});
  }, [loadPeople, loadProjects, loadLabels]);

  const defaultDue = () => {
    const d = new Date();
    d.setDate(d.getDate() + (settings.default_due_days ?? 7));
    return settings.default_due_days ? isoDate(d) : "";
  };
  const [form, setForm] = useState(() => ({
    title: task?.title || "",
    description: task?.description || "",
    project_id: task ? (task.project_id ? String(task.project_id) : "") : defaults.project_id ? String(defaults.project_id) : "",
    assigned_to: task?.assigned_to ? String(task.assigned_to) : defaults.assigned_to ? String(defaults.assigned_to) : "",
    type: task?.type || defaults.type || "feature",
    priority: task?.priority || "medium",
    due_date: task ? task.due_date || "" : defaults.due_date || defaultDue(),
    start_date: task?.start_date || "",
    estimate: task?.estimate ?? "",
    channel: task?.channel || "",
    labels: task?.labels || [],
    checklist: "",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const project = useMemo(() => projects?.find((p) => String(p.id) === form.project_id), [projects, form.project_id]);
  const marketing = project?.kind === "marketing" || MARKETING_TYPES.includes(form.type) || form.channel;
  const engineering = project?.kind === "engineering" || ["feature", "bug"].includes(form.type);
  const activeProjects = (projects || []).filter((p) => p.status === "active" || String(p.id) === form.project_id);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        title: form.title,
        description: form.description,
        assigned_to: Number(form.assigned_to),
        project_id: form.project_id ? Number(form.project_id) : null,
        type: form.type,
        priority: form.priority,
        due_date: form.due_date || null,
        start_date: form.start_date || null,
        estimate: form.estimate === "" ? null : Number(form.estimate),
        channel: form.channel || null,
        labels: form.labels,
      };
      if (!task) body.checklist = form.checklist.split("\n").map((s) => s.trim()).filter(Boolean);
      const { data } = task ? await api.patch(`/tasks/${task.id}`, body) : await api.post("/tasks", body);
      onSaved(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't save the task."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={task ? `Edit ${task.key || "task"}` : "New task"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="task-form" loading={busy}>{task ? "Save changes" : "Create task"}</Button>
        </>
      }
    >
      <form id="task-form" className="form-grid" onSubmit={submit}>
        <Field label="Title" className="span-2" htmlFor="tf-title">
          <input id="tf-title" className="input" value={form.title} onChange={set("title")} required minLength={3} maxLength={200} placeholder="What needs to be done" />
        </Field>
        <Field label="Project" htmlFor="tf-project">
          <select id="tf-project" className="select input" value={form.project_id} onChange={set("project_id")}>
            <option value="">No project</option>
            {activeProjects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Assign to" htmlFor="tf-who" hint={project ? "They'll be added to the project if they aren't already." : undefined}>
          <select id="tf-who" className="select input" value={form.assigned_to} onChange={set("assigned_to")} required>
            <option value="" disabled>Choose a person</option>
            {(people || []).map((m) => <option key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Details" className="span-2" hint="What does done look like? Acceptance criteria, links, brief." htmlFor="tf-desc">
          <textarea id="tf-desc" className="textarea" rows={4} value={form.description} onChange={set("description")} maxLength={20000} />
        </Field>
        <Field label="Type" htmlFor="tf-type">
          <select id="tf-type" className="select input" value={form.type} onChange={set("type")}>
            {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Priority" htmlFor="tf-prio">
          <select id="tf-prio" className="select input" value={form.priority} onChange={set("priority")}>
            {Object.entries(PRIORITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Start date" htmlFor="tf-start">
          <input id="tf-start" className="input" type="date" value={form.start_date} onChange={set("start_date")} />
        </Field>
        <Field label={marketing ? "Publish / due date" : "Due date"} htmlFor="tf-due">
          <input id="tf-due" className="input" type="date" value={form.due_date} onChange={set("due_date")} />
        </Field>
        {marketing && (
          <Field label="Channel" htmlFor="tf-channel">
            <select id="tf-channel" className="select input" value={form.channel} onChange={set("channel")}>
              <option value="">None</option>
              {(settings.channels || []).map((c) => <option key={c} value={c}>{c}</option>)}
              {form.channel && !(settings.channels || []).includes(form.channel) && <option value={form.channel}>{form.channel}</option>}
            </select>
          </Field>
        )}
        {(engineering || form.estimate !== "") && (
          <Field label="Estimate (points)" htmlFor="tf-est" hint="Story points or hours — whatever your team uses.">
            <input id="tf-est" className="input" type="number" min={0} max={999} value={form.estimate} onChange={set("estimate")} />
          </Field>
        )}
        <Field label="Labels" className="span-2" hint="Press Enter after each. Lowercase, up to 10.">
          <ChipInput value={form.labels} onChange={(labels) => setForm((f) => ({ ...f, labels }))} suggestions={(labels || []).map((l) => l.label)} label="Labels" />
        </Field>
        {!task && (
          <Field label="Checklist" className="span-2" hint="One item per line. The assignee ticks them off as they go." htmlFor="tf-check">
            <textarea id="tf-check" className="textarea" rows={3} value={form.checklist} onChange={set("checklist")} placeholder={"Draft\nReview with design\nSchedule"} />
          </Field>
        )}
        {error && <div className="span-2"><Callout tone="bad">{error}</Callout></div>}
      </form>
    </Modal>
  );
}
