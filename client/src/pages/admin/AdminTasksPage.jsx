import { useEffect, useMemo, useState } from "react";
import api from "../../api";
import TaskComments from "../../components/TaskComments";

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

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data));
  const loadUsers = () => api.get("/admin/users").then((r) => setUsers(r.data));

  useEffect(() => { loadTasks(); loadUsers(); }, []);

  const createTask = async (e) => {
    e.preventDefault();
    await api.post("/tasks", form);
    setForm({ title: "", description: "", assigned_to: "", due_date: "", type: "feature", priority: "medium" });
    setShowForm(false);
    loadTasks();
  };

  const download = async (taskId, format) => {
    const key = `${taskId}-${format}`;
    setDownloadingKey(key);
    try {
      const res = await api.get(`/admin/tasks/${taskId}/download?format=${format}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `task-${taskId}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "Download blocked — check network/admin access.");
    } finally {
      setDownloadingKey(null);
    }
  };

  const downloadFile = async (taskId) => {
    const key = `${taskId}-file`;
    setDownloadingKey(key);
    try {
      const res = await api.get(`/admin/tasks/${taskId}/file`, { responseType: "blob" });
      const disposition = res.headers["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `task-${taskId}-attachment`;
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "No attachment found, or download blocked.");
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

  return (
    <div>
      <div style={styles.statRow}>
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} color="#79705f" />
        <StatCard label="In progress" value={stats.in_progress} color="#c98a3e" />
        <StatCard label="Completed" value={stats.completed} color="#5fa876" />
        <StatCard label="Overdue" value={stats.overdue} color="#e0836b" />
      </div>

      <div style={styles.toolbar}>
        <input
          style={styles.search}
          placeholder="Search title or assignee..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <select style={styles.filterSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All types</option>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button style={styles.button} onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Assign Task"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createTask} style={styles.form}>
          <input style={styles.input} placeholder="Task title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <input style={styles.input} placeholder="Description" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select style={styles.input} value={form.assigned_to}
            onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} required>
            <option value="">Assign to...</option>
            {users.filter((u) => u.role === "member").map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <select style={styles.input} value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select style={styles.input} value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input style={styles.input} type="date" value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <button style={styles.button} type="submit">Assign Task</button>
        </form>
      )}

      {users.filter((u) => u.role === "member").length === 0 && (
        <p style={{ color: "#c9832a", marginBottom: 16 }}>
          No team members yet — add them in the "Team Members" tab first.
        </p>
      )}

      <div style={styles.list}>
        {filtered.map((t) => {
          const pr = priorityMeta(t.priority);
          const overdue = isOverdue(t);
          return (
            <div key={t.id} style={styles.card}>
              <div style={{ flex: 1 }}>
                <div style={styles.cardTop}>
                  <strong>{t.title}</strong>
                  <span style={{ ...styles.badge, borderColor: pr.color, color: pr.color }}>{pr.label}</span>
                  <span style={styles.badgeType}>{typeLabel(t.type)}</span>
                  <span style={{ color: statusColor(t.status) }}>{t.status.replace("_", " ")}</span>
                </div>
                <div style={{ fontSize: 13, color: "#79705f", marginTop: 4 }}>
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
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.smallBtn} disabled={downloadingKey === `${t.id}-pdf`} onClick={() => download(t.id, "pdf")}>
                    {downloadingKey === `${t.id}-pdf` ? "Downloading..." : "PDF"}
                  </button>
                  <button style={styles.smallBtn} disabled={downloadingKey === `${t.id}-docx`} onClick={() => download(t.id, "docx")}>
                    {downloadingKey === `${t.id}-docx` ? "Downloading..." : "Word"}
                  </button>
                  {t.has_attachment && (
                    <button style={styles.smallBtn} disabled={downloadingKey === `${t.id}-file`} onClick={() => downloadFile(t.id)}>
                      {downloadingKey === `${t.id}-file` ? "Downloading..." : "Attachment"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p style={{ color: "#79705f" }}>No tasks match these filters.</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, color = "#f0e9dc" }) {
  return (
    <div style={styles.statCard}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#79705f" }}>{label}</div>
    </div>
  );
}

function statusColor(status) {
  if (status === "completed") return "#5fa876";
  if (status === "in_progress") return "#c98a3e";
  return "#79705f";
}

const styles = {
  statRow: { display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" },
  statCard: { background: "#161310", border: "1px solid #221d16", borderRadius: 4, padding: "14px 18px", minWidth: 100 },
  toolbar: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  search: { flex: 1, minWidth: 180, padding: "8px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da" },
  filterSelect: { padding: "8px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da" },
  form: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24, background: "#161310", border: "1px solid #221d16", padding: 16, borderRadius: 4 },
  input: { padding: "8px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da" },
  button: { padding: "8px 16px", borderRadius: 3, border: "none", background: "#c98a3e", color: "#171310", fontWeight: 700, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161310", border: "1px solid #221d16", padding: 14, borderRadius: 4 },
  cardTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  badge: { fontSize: 11, fontFamily: "ui-monospace, monospace", border: "1px solid", borderRadius: 3, padding: "1px 6px" },
  badgeType: { fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#8a8071", border: "1px solid #2f2820", borderRadius: 3, padding: "1px 6px" },
  smallBtn: { padding: "6px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da", cursor: "pointer" },
};