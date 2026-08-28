import { useEffect, useRef, useState } from "react";
import api from "../api";
import DirectFileTransfer from "./DirectFileTransfer";
import useOnlineStatus from "../hooks/useOnlineStatus";

export default function ChatThread({ otherUserId, otherUserName }) {
  const { isOnline } = useOnlineStatus();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const fileInputRef = useRef(null);

  const load = () => {
    if (!otherUserId) return;
    api.get(`/messages/${otherUserId}`).then((r) => setMessages(r.data));
  };

  useEffect(() => { load(); }, [otherUserId]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    if (!otherUserId) return;

    const formData = new FormData();
    if (text.trim()) formData.append("message", text.trim());
    if (file) formData.append("file", file);

    await api.post(`/messages/${otherUserId}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    setText("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  };

  const downloadAttachment = async (m) => {
    setDownloadingId(m.id);
    try {
      const res = await api.get(`/messages/file/${m.id}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = m.file_name || "attachment";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || "Couldn't download attachment.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (!otherUserId) {
    return <p style={{ color: "#79705f" }}>Select someone to message.</p>;
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>{otherUserName}</div>
      <div style={styles.thread}>
        {messages.length === 0 && <p style={{ color: "#5c5344", fontSize: 13 }}>No messages yet — say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} style={styles.msg}>
            {m.message && <span style={styles.text}>{m.message}</span>}
            {m.file_path && (
              <button style={styles.attachment} disabled={downloadingId === m.id} onClick={() => downloadAttachment(m)}>
                {downloadingId === m.id ? "Downloading..." : `📎 ${m.file_name || "attachment"}`}
              </button>
            )}
            <span style={styles.time}>{new Date(m.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <form onSubmit={send} style={styles.form}>
        <input
          style={styles.input}
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={styles.fileInput}
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        <button style={styles.sendBtn} type="submit">Send</button>
      </form>
      {file && <div style={styles.filePreview}>Attaching: {file.name}</div>}
      <DirectFileTransfer
        otherUserId={otherUserId}
        otherUserName={otherUserName}
        isOnline={isOnline(otherUserId)}
      />
    </div>
  );
}

const styles = {
  wrap: { background: "#161310", border: "1px solid #221d16", borderRadius: 4, padding: 16, display: "flex", flexDirection: "column", height: 480 },
  header: { fontSize: 14, fontWeight: 700, color: "#f0e9dc", marginBottom: 10, borderBottom: "1px solid #221d16", paddingBottom: 10 },
  thread: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 },
  msg: { background: "#100e0b", border: "1px solid #221d16", borderRadius: 4, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 },
  text: { fontSize: 13.5, color: "#ece6da", display: "block" },
  time: { fontSize: 10.5, color: "#5c5344" },
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  input: { flex: 1, minWidth: 120, padding: "9px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da" },
  fileInput: { color: "#a8a091", fontSize: 12, maxWidth: 140 },
  sendBtn: { padding: "9px 16px", borderRadius: 3, border: "none", background: "#c98a3e", color: "#171310", fontWeight: 700, cursor: "pointer" },
  filePreview: { fontSize: 11.5, color: "#a8895a", marginTop: 6 },
  attachment: {
    alignSelf: "flex-start",
    background: "#1c1712",
    border: "1px solid #2f2820",
    color: "#c98a3e",
    fontSize: 12.5,
    padding: "5px 10px",
    borderRadius: 3,
    cursor: "pointer",
  },
};