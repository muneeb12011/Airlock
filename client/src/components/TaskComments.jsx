import { useEffect, useState } from "react";
import api from "../api";

export default function TaskComments({ taskId }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = () => api.get(`/tasks/${taskId}/comments`).then((r) => { setComments(r.data); setLoaded(true); });

  useEffect(() => { if (open && !loaded) load(); }, [open]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api.post(`/tasks/${taskId}/comments`, { message: text.trim() });
    setText("");
    load();
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button style={styles.toggle} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide comments" : `Comments${comments.length ? ` (${comments.length})` : ""}`}
      </button>
      {open && (
        <div style={styles.panel}>
          <div style={styles.thread}>
            {comments.length === 0 && <p style={styles.empty}>No comments yet — ask a question below.</p>}
            {comments.map((c) => (
              <div key={c.id} style={styles.msg}>
                <span style={{ ...styles.author, color: c.author_role === "admin" ? "#c98a3e" : "#8fb3a8" }}>
                  {c.author_name}
                </span>
                <span style={styles.text}>{c.message}</span>
                <span style={styles.time}>{new Date(c.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <form onSubmit={send} style={styles.form}>
            <input
              style={styles.input}
              placeholder="Write a message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button style={styles.sendBtn} type="submit">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

const styles = {
  toggle: { background: "transparent", border: "1px solid #2f2820", color: "#a8895a", fontSize: 12.5, padding: "5px 10px", borderRadius: 3, cursor: "pointer" },
  panel: { marginTop: 8, background: "#100e0b", border: "1px solid #221d16", borderRadius: 4, padding: 10 },
  thread: { display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto", marginBottom: 8 },
  empty: { color: "#5c5344", fontSize: 12.5, margin: 0 },
  msg: { display: "flex", flexDirection: "column", gap: 2, borderBottom: "1px solid #1a1712", paddingBottom: 6 },
  author: { fontSize: 11.5, fontWeight: 700, fontFamily: "ui-monospace, monospace" },
  text: { fontSize: 13, color: "#ece6da" },
  time: { fontSize: 10.5, color: "#5c5344" },
  form: { display: "flex", gap: 6 },
  input: { flex: 1, padding: "7px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#0b0a08", color: "#ece6da", fontSize: 13 },
  sendBtn: { padding: "7px 14px", borderRadius: 3, border: "none", background: "#c98a3e", color: "#171310", fontWeight: 700, cursor: "pointer", fontSize: 13 },
};