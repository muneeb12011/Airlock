import { useEffect, useMemo, useState } from "react";
import api from "../../api";
import TaskComments from "../../components/TaskComments";
import { readAxiosError, saveAxiosBlob } from "../../lib/download";

const TYPES = [
  { value: "feature", label: "Feature" },
  { value: "bug", label: "Bug Fix" },
  { value: "docs", label: "Documentation" },
  { value: "research", label: "Research" },
  { value: "review", label: "Review" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "#5c5344" },
  { value: "medium", label: "Medium", color: "#c98a3e" },
  { value: "high", label: "High", color: "#e0836b" },
  { value: "urgent", label: "Urgent", color: "#ff5c4d" },
];

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    title: "", description: "", assigned_to: "", due_date: "",
    type: "feature", priority: "medium",
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data));
  const loadUsers = () => api.get("/admin/users").then((r) => setUsers(r.data));

  useEffect(() => {
    Promise.all([loadTasks(), loadUsers()])
      .catch(async (err) => setError(await readAxiosError(err, "Could not load tasks.")))
      .finally(() => setLoading(false));
  }, []);

  const createTask = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/tasks", form);
      setForm({ title: "", description: "", assigned_to: "", due_date: "", type: "feature", priority: "medium" });
      setShowForm(false);
      await loadTasks();
    } catch (err) {
      setError(await readAxiosError(err, "Could not create task."));
    } finally {
      setSaving(false);
    }
  };

  const download = async (taskId, format) => {
    const key = `${taskId}-${format}`;
    setDownloadingKey(key);
    try {
      const res = await api.get(`/admin/tasks/${taskId}/download?format=${format}`, { responseType: "blob" });
      await saveAxiosBlob(res, `task-${taskId}.${format}`);
    } catch (err) {
      alert(await readAxiosError(err, "Download blocked — check network/admin access."));
    } finally {
      setDownloadingKey(null);
    }
  };

  const downloadFile = async (taskId) => {
    const key = `${taskId}-file`;
    setDownloadingKey(key);
    try {
      const res = await api.get(`/admin/tasks/${taskId}/file`, { responseType: "blob" });
      await saveAxiosBlob(res, `task-${taskId}-attachment`);
    } catch (err) {
      alert(await readAxiosError(err, "No attachment found, or download blocked."));
    } finally {
      setDownloadingKey(null);
    }
  };

  const isOverdue = (t) => t.due_date && t.status !== "completed" && new Date(t.due_date) < new Date(new Date().toDateString());

  const stats = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    overdue: tasks.filter(isOverdue).length,
  }), [tasks]);

  const filtered = tasks.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (search && !`${t.title} ${t.assignee_name || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const priorityMeta = (p) => PRIORITIES.find((x) => x.value === p) || PRIORITIES[1];
  const typeLabel = (t) => TYPES.find((x) => x.value === t)?.label || "Other";
  const members = users.filter((u) => u.role === "member");

  if (loading) return <p className="muted">Loading tasks…</p>;

  return (
    <div>
      {error && <div className="banner error">{error}</div>}

      <div className="stat-row">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} color="#79705f" />
        <StatCard label="In progress" value={stats.in_progress} color="#c98a3e" />
        <StatCard label="Completed" value={stats.completed} color="#5fa876" />
        <StatCard label="Overdue" value={stats.overdue} color="#e0836b" />
      </div>

      <div className="toolbar">
        <input
          className="search"
          placeholder="Search title or assignee..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="btn" type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Assign task"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createTask} className="panel">
          <input className="field" placeholder="Task title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <input className="field" placeholder="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="field" value={form.assigned_to}
            onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} required>
            <option value="">Assign to...</option>
            {members.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select className="field" value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="field" value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input className="field" type="date" value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Assigning…" : "Assign task"}
          </button>
        </form>
      )}

      {members.length === 0 && (
        <p className="warn" style={{ marginBottom: 16 }}>
          No team members yet — add them in the Team tab first.
        </p>
      )}

      <div className="stack">
        {filtered.map((t) => {
          const pr = priorityMeta(t.priority);
          const overdue = isOverdue(t);
          return (
            <div key={t.id} className="card card-row">
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <strong>{t.title}</strong>
                  <span className="badge" style={{ borderColor: pr.color, color: pr.color }}>{pr.label}</span>
                  <span className="badge-type">{typeLabel(t.type)}</span>
                  <span style={{ color: statusColor(t.status) }}>{t.status.replace("_", " ")}</span>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Assigned to {t.assignee_name || "—"}
                  {t.due_date && (
                    <span style={{ color: overdue ? "#e0836b" : "#79705f", marginLeft: 10 }}>
                      {overdue ? "Overdue — " : "Due "}{new Date(t.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <TaskComments taskId={t.id} />
              </div>
              {t.status === "completed" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-small" disabled={downloadingKey === `${t.id}-pdf`} onClick={() => download(t.id, "pdf")}>
                    {downloadingKey === `${t.id}-pdf` ? "Downloading..." : "PDF"}
                  </button>
                  <button className="btn-small" disabled={downloadingKey === `${t.id}-docx`} onClick={() => download(t.id, "docx")}>
                    {downloadingKey === `${t.id}-docx` ? "Downloading..." : "Word"}
                  </button>
                  {t.has_attachment && (
                    <button className="btn-small" disabled={downloadingKey === `${t.id}-file`} onClick={() => downloadFile(t.id)}>
                      {downloadingKey === `${t.id}-file` ? "Downloading..." : "Attachment"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="muted">No tasks match these filters.</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "#f0e9dc" }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function statusColor(status) {
  if (status === "completed") return "#5fa876";
  if (status === "in_progress") return "#c98a3e";
  return "#79705f";
}
