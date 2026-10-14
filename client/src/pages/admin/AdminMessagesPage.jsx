import { useEffect, useState } from "react";
import api from "../../api";
import ChatThread from "../../components/ChatThread";
import useOnlineStatus from "../../hooks/useOnlineStatus";
import { readAxiosError } from "../../lib/download";

export default function AdminMessagesPage() {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const { isOnline } = useOnlineStatus();

  useEffect(() => {
    api.get("/messages/contacts")
      .then((r) => setMembers(r.data))
      .catch(async (err) => setError(await readAxiosError(err, "Could not load contacts.")));
  }, []);

  return (
    <div>
      {error && <div className="banner error">{error}</div>}
      <div className="split">
        <div className="contact-list">
          {members.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No team members yet.</p>}
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className={selected?.id === m.id ? "contact active" : "contact"}
              onClick={() => setSelected(m)}
            >
              <span className={`live-dot ${isOnline(m.id) ? "ok" : ""}`} />
              {m.name}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ChatThread otherUserId={selected?.id} otherUserName={selected?.name} />
        </div>
      </div>
    </div>
  );
}
