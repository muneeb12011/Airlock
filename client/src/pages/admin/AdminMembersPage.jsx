import { useEffect, useState } from "react";
import api from "../../api";

export default function AdminMembersPage() {
  const [users, setUsers] = useState([]);
  const [memberForm, setMemberForm] = useState({ name: "", email: "", password: "" });
  const [memberMsg, setMemberMsg] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const loadUsers = () => api.get("/admin/users").then((r) => setUsers(r.data));
  useEffect(() => { loadUsers(); }, []);

  const createMember = async (e) => {
    e.preventDefault();
    setMemberMsg("");
    try {
      await api.post("/auth/register", { ...memberForm, role: "member" });
      setMemberMsg(`${memberForm.name} created — they can log in now.`);
      setMemberForm({ name: "", email: "", password: "" });
      loadUsers();
    } catch (err) {
      setMemberMsg(err.response?.data?.error || "Could not create member");
    }
  };

  const deleteMember = async (u) => {
    const confirmed = window.confirm(
      `Delete ${u.name}? This removes their account, all their tasks, messages, and attached files permanently. This can't be undone.`
    );
    if (!confirmed) return;

    setDeletingId(u.id);
    setMemberMsg("");
    try {
      await api.delete(`/admin/users/${u.id}`);
      setMemberMsg(`${u.name} was deleted.`);
      loadUsers();
    } catch (err) {
      setMemberMsg(err.response?.data?.error || "Could not delete member");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <form onSubmit={createMember} style={styles.form}>
        <input style={styles.input} placeholder="Full name" value={memberForm.name}
          onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} required />
        <input style={styles.input} type="email" placeholder="Email (their login)" value={memberForm.email}
          onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} required />
        <input style={styles.input} type="text" placeholder="Password (give them this)" value={memberForm.password}
          onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} required />
        <button style={styles.button} type="submit">Create Member</button>
      </form>
      {memberMsg && <p style={{ color: memberMsg.includes("deleted") || memberMsg.includes("created") ? "#5fa876" : "#e0836b" }}>{memberMsg}</p>}

      <div style={styles.list}>
        {users.filter((u) => u.role === "member").map((u) => (
          <div key={u.id} style={styles.card}>
            <div>
              <strong>{u.name}</strong>
              <div style={{ fontSize: 13, color: "#79705f" }}>{u.email}</div>
            </div>
            <button
              style={styles.deleteBtn}
              onClick={() => deleteMember(u)}
              disabled={deletingId === u.id}
            >
              {deletingId === u.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        ))}
        {users.filter((u) => u.role === "member").length === 0 && (
          <p style={{ color: "#79705f" }}>No team members added yet.</p>
        )}
      </div>
    </div>
  );
}

const styles = {
  form: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24, background: "#161310", border: "1px solid #221d16", padding: 16, borderRadius: 4 },
  input: { padding: "8px 10px", borderRadius: 3, border: "1px solid #2f2820", background: "#100e0b", color: "#ece6da" },
  button: { padding: "8px 16px", borderRadius: 3, border: "none", background: "#c98a3e", color: "#171310", fontWeight: 700, cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  card: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161310", border: "1px solid #221d16", padding: 14, borderRadius: 4 },
  deleteBtn: { padding: "7px 14px", borderRadius: 3, border: "1px solid #e0836b", background: "transparent", color: "#e0836b", cursor: "pointer", fontSize: 13 },
};