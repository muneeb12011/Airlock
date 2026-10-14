import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";
import { readAxiosError } from "../../lib/download";

export default function MemberPendingPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState(null);

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data.filter((t) => t.status === "pending")));

  useEffect(() => {
    loadTasks()
      .catch(async (err) => setError(await readAxiosError(err, "Could not load tasks.")))
      .finally(() => setLoading(false));
  }, []);

  const startTask = async (id) => {
    setStartingId(id);
    setError("");
    try {
      await api.patch(`/tasks/${id}/status`, { status: "in_progress" });
      await loadTasks();
    } catch (err) {
      setError(await readAxiosError(err, "Could not start task."));
    } finally {
      setStartingId(null);
    }
  };

  if (loading) return <p className="muted">Loading pending work…</p>;

  return (
    <div>
      <h2 className="page-heading">Pending — not started yet</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="stack">
        {tasks.length === 0 && <p className="muted">Nothing waiting on you right now.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="card">
            <strong>{t.title}</strong>
            <p className="muted" style={{ margin: "6px 0", fontSize: 14 }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
            <button className="btn" style={{ marginTop: 10 }} onClick={() => startTask(t.id)} disabled={startingId === t.id}>
              {startingId === t.id ? "Starting…" : "Start task"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
