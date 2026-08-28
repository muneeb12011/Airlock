import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";

export default function MemberPendingPage() {
  const [tasks, setTasks] = useState([]);

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data.filter((t) => t.status === "pending")));
  useEffect(() => { loadTasks(); }, []);

  const startTask = async (id) => {
    await api.patch(`/tasks/${id}/status`, { status: "in_progress" });
    loadTasks();
  };

  return (
    <div>
      <h2 style={styles.heading}>Pending &mdash; not started yet</h2>
      <div style={styles.list}>
        {tasks.length === 0 && <p style={{ color: "#79705f" }}>Nothing waiting on you right now.</p>}
        {tasks.map((t) => (
          <div key={t.id} style={styles.card}>
            <strong>{t.title}</strong>
            <p style={{ color: "#a8a091", fontSize: 14, margin: "6px 0" }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
            <button style={styles.button} onClick={() => startTask(t.id)}>Start Task</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  heading: { fontSize: 16, fontWeight: 600, color: "#f0e9dc", marginBottom: 16 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#161310", border: "1px solid #221d16", padding: 16, borderRadius: 4 },
  button: {
    padding: "8px 16px", borderRadius: 3, border: "none", background: "#c98a3e",
    color: "#171310", fontWeight: 700, cursor: "pointer", marginTop: 10,
  },
};