import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";

export default function MemberCompletedPage() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    api.get("/tasks").then((r) => setTasks(r.data.filter((t) => t.status === "completed")));
  }, []);

  return (
    <div>
      <h2 style={styles.heading}>Completed &mdash; your history</h2>
      <div style={styles.list}>
        {tasks.length === 0 && <p style={{ color: "#79705f" }}>Nothing completed yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} style={styles.card}>
            <strong>{t.title}</strong>
            <p style={{ color: "#a8a091", fontSize: 14, margin: "6px 0" }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  heading: { fontSize: 16, fontWeight: 600, color: "#f0e9dc", marginBottom: 16 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#161310", border: "1px solid #221d16", padding: 16, borderRadius: 4, opacity: 0.85 },
};