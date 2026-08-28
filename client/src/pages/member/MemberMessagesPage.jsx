import { useEffect, useState } from "react";
import api from "../../api";
import ChatThread from "../../components/ChatThread";

export default function MemberMessagesPage() {
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    api.get("/messages/contacts").then((r) => setAdmin(r.data[0] || null));
  }, []);

  return <ChatThread otherUserId={admin?.id} otherUserName={admin?.name || "Admin"} />;
}