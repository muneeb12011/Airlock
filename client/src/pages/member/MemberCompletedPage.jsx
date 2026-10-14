import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";
import { readAxiosError } from "../../lib/download";

export default function MemberCompletedPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/tasks")
      .then((r) => setTasks(r.data.filter((t) => t.status === "completed")))
      .catch(async (err) => setError(await readAxiosError(err, "Could not load tasks.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading completed work…</p>;

  return (
    <div>
      <h2 className="page-heading">Completed — your history</h2>
      {error && <div className="banner error">{error}</div>}
      <div className="stack">
        {tasks.length === 0 && <p className="muted">Nothing completed yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="card" style={{ opacity: 0.9 }}>
            <strong>{t.title}</strong>
            <p className="muted" style={{ margin: "6px 0", fontSize: 14 }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
