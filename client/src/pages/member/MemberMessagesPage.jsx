import { useEffect, useState } from "react";
import api from "../../api";
import ChatThread from "../../components/ChatThread";
import { readAxiosError } from "../../lib/download";

export default function MemberMessagesPage() {
  const [admin, setAdmin] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/messages/contacts")
      .then((r) => setAdmin(r.data[0] || null))
      .catch(async (err) => setError(await readAxiosError(err, "Could not load messages.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Opening messages…</p>;
  if (error) return <div className="banner error">{error}</div>;

  return <ChatThread otherUserId={admin?.id} otherUserName={admin?.name || "Admin"} />;
}
