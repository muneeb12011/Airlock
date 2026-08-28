import { useEffect, useState } from "react";
import api from "../api";
import useAuthStore from "../store/useAuthStore";

export default function UserDashboard() {
  const [tasks, setTasks] = useState([]);
  const [notesById, setNotesById] = useState({});
  const [fileById, setFileById] = useState({});
  const logout = useAuthStore((s) => s.logout);
  const currentUser = useAuthStore((s) => s.user);

  const loadTasks = () => api.get("/tasks").then((r) => setTasks(r.data));
  useEffect(() => { loadTasks(); }, []);

  const startTask = async (id) => {
    await api.patch(`/tasks/${id}/status`, { status: "in_progress" });
    loadTasks();
  };

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
    <div style={styles.wrap}>
      <header style={styles.header}>
        <h2>My Tasks — {currentUser?.name}</h2>
        <button style={styles.logoutBtn} onClick={logout}>Log out</button>
      </header>

      <div style={styles.list}>
        {tasks.length === 0 && <p style={{ color: "#888" }}>No tasks assigned yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} style={styles.card}>
            <strong>{t.title}</strong>
            <p style={{ color: "#aaa", fontSize: 14 }}>{t.description}</p>
            <div style={{ fontSize: 13, color: "#999" }}>
              Status: <span style={{ color: statusColor(t.status) }}>{t.status}</span>
              {t.due_date && ` — Due ${t.due_date}`}
            </div>

            {t.status === "pending" && (
              <button style={styles.button} onClick={() => startTask(t.id)}>Start Task</button>
            )}

            {t.status === "in_progress" && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  style={styles.textarea}
                  placeholder="Notes about completed work..."
                  value={notesById[t.id] || ""}
                  onChange={(e) => setNotesById({ ...notesById, [t.id]: e.target.value })}
                />
                <input
                  type="file"
                  onChange={(e) => setFileById({ ...fileById, [t.id]: e.target.files[0] })}
                />
                <button style={styles.button} onClick={() => submitTask(t.id)}>Submit Completed Work</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusColor(status) {
  if (status === "completed") return "#4caf50";
  if (status === "in_progress") return "#c9832a";
  return "#888";
}

const styles = {
  wrap: { background: "#0f0f10", minHeight: "100vh", color: "#eee", padding: 24, fontFamily: "sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  logoutBtn: { background: "transparent", border: "1px solid #444", color: "#eee", padding: "6px 12px", borderRadius: 6, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: { background: "#1a1a1c", padding: 16, borderRadius: 10 },
  button: { padding: "8px 16px", borderRadius: 6, border: "none", background: "#c9832a", color: "#111", fontWeight: 600, cursor: "pointer", marginTop: 8 },
  textarea: { padding: 8, borderRadius: 6, border: "1px solid #333", background: "#0f0f10", color: "#eee", minHeight: 60 },
};
