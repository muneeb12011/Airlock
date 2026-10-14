import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";
import { readAxiosError } from "../../lib/download";

export default function MemberInProgressPage() {
  const [tasks, setTasks] = useState([]);
  const [notesById, setNotesById] = useState({});
  const [fileById, setFileById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittingId, setSubmittingId] = useState(null);

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data.filter((t) => t.status === "in_progress")));

  useEffect(() => {
    loadTasks()
      .catch(async (err) => setError(await readAxiosError(err, "Could not load tasks.")))
      .finally(() => setLoading(false));
  }, []);

  const submitTask = async (id) => {
    setSubmittingId(id);
    setError("");
    try {
      const formData = new FormData();
      formData.append("notes", notesById[id] || "");
      if (fileById[id]) formData.append("file", fileById[id]);
      await api.post(`/tasks/${id}/submit`, formData);
      await loadTasks();
    } catch (err) {
      setError(await readAxiosError(err, "Could not submit work."));
    } finally {
      setSubmittingId(null);
    }
  };

  if (loading) return <p className="muted">Loading in-progress work…</p>;

  return (
    <div>
      <h2 className="page-heading">In progress — submit when done</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="stack">
        {tasks.length === 0 && <p className="muted">Nothing in progress. Start a task from Pending.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="card">
            <strong>{t.title}</strong>
            <p className="muted" style={{ margin: "6px 0", fontSize: 14 }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                className="textarea"
                placeholder="Notes about completed work..."
                value={notesById[t.id] || ""}
                onChange={(e) => setNotesById({ ...notesById, [t.id]: e.target.value })}
              />
              <input
                type="file"
                style={{ color: "#a8a091" }}
                onChange={(e) => setFileById({ ...fileById, [t.id]: e.target.files[0] })}
              />
              <button className="btn" onClick={() => submitTask(t.id)} disabled={submittingId === t.id}>
                {submittingId === t.id ? "Submitting…" : "Submit completed work"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
