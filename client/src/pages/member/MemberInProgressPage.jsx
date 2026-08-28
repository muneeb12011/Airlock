import { useEffect, useState } from "react";
import api from "../../api";
import TaskMeta from "../../components/TaskMeta";
import TaskComments from "../../components/TaskComments";

export default function MemberInProgressPage() {
  const [tasks, setTasks] = useState([]);
  const [notesById, setNotesById] = useState({});
  const [fileById, setFileById] = useState({});

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data.filter((t) => t.status === "in_progress")));
  useEffect(() => { loadTasks(); }, []);

  const submitTask = async (id) => {
    const formData = new FormData();
    formData.append("notes", notesById[id] || "");
    if (fileById[id]) formData.append("file", fileById[id]);
    await api.post(`/tasks/${id}/submit`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    loadTasks();
  };

  return (
    <div>
      <h2 style={styles.heading}>In Progress &mdash; submit when done</h2>
      <div style={styles.list}>
        {tasks.length === 0 && <p style={{ color: "#79705f" }}>Nothing in progress. Start a task from Pending.</p>}
        {tasks.map((t) => (
          <div key={t.id} style={styles.card}>
            <strong>{t.title}</strong>
            <p style={{ color: "#a8a091", fontSize: 14, margin: "6px 0" }}>{t.description}</p>
            <TaskMeta task={t} />
            <TaskComments taskId={t.id} />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                style={styles.textarea}
                placeholder="Notes about completed work..."
                value={notesById[t.id] || ""}
                onChange={(e) => setNotesById({ ...notesById, [t.id]: e.target.value })}
              />
              <input
                type="file"
                style={{ color: "#a8a091" }}
                onChange={(e) => setFileById({ ...fileById, [t.id]: e.target.files[0] })}
              />
              <button style={styles.button} onClick={() => submitTask(t.id)}>Submit Completed Work</button>
            </div>
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
  textarea: { padding: 8, borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da", minHeight: 60 },
  button: {
    padding: "8px 16px", borderRadius: 3, border: "none", background: "#c98a3e",
    color: "#171310", fontWeight: 700, cursor: "pointer",
  },
};