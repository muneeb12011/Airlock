import { useEffect, useState } from "react";
import api from "../../api";
import ChatThread from "../../components/ChatThread";

export default function AdminMessagesPage() {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => { api.get("/messages/contacts").then((r) => setMembers(r.data)); }, []);

  return (
    <div style={{ display: "flex", gap: 20 }}>
      <div style={styles.sidebar}>
        {members.length === 0 && <p style={{ color: "#79705f", fontSize: 13 }}>No team members yet.</p>}
        {members.map((m) => (
          <button
            key={m.id}
            style={selected?.id === m.id ? styles.contactActive : styles.contact}
            onClick={() => setSelected(m)}
          >
            {m.name}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }}>
        <ChatThread otherUserId={selected?.id} otherUserName={selected?.name} />
      </div>
    </div>
  );
}

const styles = {
  sidebar: { width: 180, display: "flex", flexDirection: "column", gap: 4 },
  contact: { textAlign: "left", background: "transparent", border: "1px solid #221d16", color: "#a8a091", padding: "10px 12px", borderRadius: 3, cursor: "pointer" },
  contactActive: { textAlign: "left", background: "#1c1712", border: "1px solid #c98a3e", color: "#f0e9dc", padding: "10px 12px", borderRadius: 3, cursor: "pointer", fontWeight: 600 },
};