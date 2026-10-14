import { useEffect, useRef, useState } from "react";
import api from "../api";
import DirectFileTransfer from "./DirectFileTransfer";
import useOnlineStatus from "../hooks/useOnlineStatus";
import { readAxiosError, saveAxiosBlob } from "../lib/download";

export default function ChatThread({ otherUserId, otherUserName }) {
  const { isOnline } = useOnlineStatus();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const threadRef = useRef(null);

  const load = () => {
    if (!otherUserId) return Promise.resolve();
    return api.get(`/messages/${otherUserId}`).then((r) => setMessages(r.data));
  };

  useEffect(() => {
    setError("");
    load().catch(async (err) => setError(await readAxiosError(err, "Could not load messages.")));
  }, [otherUserId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    if (!otherUserId) return;
    setSending(true);
    setError("");
    try {
      const formData = new FormData();
      if (text.trim()) formData.append("message", text.trim());
      if (file) formData.append("file", file);
      await api.post(`/messages/${otherUserId}`, formData);
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError(await readAxiosError(err, "Could not send message."));
    } finally {
      setSending(false);
    }
  };

  const downloadAttachment = async (m) => {
    setDownloadingId(m.id);
    try {
      const res = await api.get(`/messages/file/${m.id}`, { responseType: "blob" });
      await saveAxiosBlob(res, m.file_name || "attachment");
    } catch (err) {
      alert(await readAxiosError(err, "Couldn't download attachment."));
    } finally {
      setDownloadingId(null);
    }
  };

  if (!otherUserId) {
    return <p className="muted">Select someone to message.</p>;
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: "min(70vh, 520px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
        <span className={`live-dot ${isOnline(otherUserId) ? "ok" : ""}`} />
        <strong>{otherUserName}</strong>
        <span className="muted">{isOnline(otherUserId) ? "online" : "offline"}</span>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
        {messages.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No messages yet — say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className="card" style={{ background: "var(--bg-inset)", padding: "8px 10px" }}>
            {m.message && <span>{m.message}</span>}
            {m.file_path && (
              <button className="btn-small" type="button" disabled={downloadingId === m.id} onClick={() => downloadAttachment(m)}>
                {downloadingId === m.id ? "Downloading..." : `📎 ${m.file_name || "attachment"}`}
              </button>
            )}
            <span className="muted" style={{ fontSize: 10.5 }}>{new Date(m.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="toolbar" style={{ marginBottom: 0 }}>
        <input
          className="field"
          style={{ flex: 1, minWidth: 120 }}
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <input
          ref={fileInputRef}
          type="file"
          style={{ color: "#a8a091", fontSize: 12, maxWidth: 160 }}
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
        <button className="btn" type="submit" disabled={sending}>{sending ? "Sending…" : "Send"}</button>
      </form>
      {file && <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>Attaching: {file.name}</div>}
      <DirectFileTransfer
        otherUserId={otherUserId}
        otherUserName={otherUserName}
        isOnline={isOnline(otherUserId)}
      />
    </div>
  );
}
