import { useEffect, useState } from "react";
import api from "../../api";
import { readAxiosError } from "../../lib/download";

export default function AdminMembersPage() {
  const [users, setUsers] = useState([]);
  const [memberForm, setMemberForm] = useState({ name: "", email: "", password: "" });
  const [memberMsg, setMemberMsg] = useState("");
  const [memberOk, setMemberOk] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadUsers = () => api.get("/admin/users").then((r) => setUsers(r.data));
  useEffect(() => {
    loadUsers()
      .catch(async (err) => {
        setMemberOk(false);
        setMemberMsg(await readAxiosError(err, "Could not load members."));
      })
      .finally(() => setLoading(false));
  }, []);

  const createMember = async (e) => {
    e.preventDefault();
    setMemberMsg("");
    setSaving(true);
    try {
      await api.post("/auth/register", { ...memberForm, role: "member" });
      setMemberOk(true);
      setMemberMsg(`${memberForm.name} created — they can log in now.`);
      setMemberForm({ name: "", email: "", password: "" });
      await loadUsers();
    } catch (err) {
      setMemberOk(false);
      setMemberMsg(await readAxiosError(err, "Could not create member"));
    } finally {
      setSaving(false);
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
      setMemberOk(true);
      setMemberMsg(`${u.name} was deleted.`);
      await loadUsers();
    } catch (err) {
      setMemberOk(false);
      setMemberMsg(await readAxiosError(err, "Could not delete member"));
    } finally {
      setDeletingId(null);
    }
  };

  const members = users.filter((u) => u.role === "member");

  if (loading) return <p className="muted">Loading team…</p>;

  return (
    <div>
      <form onSubmit={createMember} className="panel">
        <input className="field" placeholder="Full name" value={memberForm.name}
          onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} required />
        <input className="field" type="email" placeholder="Email (their login)" value={memberForm.email}
          onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} required />
        <input className="field" type="text" placeholder="Password (give them this)" value={memberForm.password}
          onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} required minLength={6} />
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create member"}
        </button>
      </form>
      {memberMsg && <p className={memberOk ? "ok" : "danger"}>{memberMsg}</p>}

      <div className="stack">
        {members.map((u) => (
          <div key={u.id} className="card card-row">
            <div>
              <strong>{u.name}</strong>
              <div className="muted">{u.email}</div>
            </div>
            <button
              className="btn-danger"
              type="button"
              onClick={() => deleteMember(u)}
              disabled={deletingId === u.id}
            >
              {deletingId === u.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        ))}
        {members.length === 0 && (
          <p className="muted">No team members added yet.</p>
        )}
      </div>
    </div>
  );
}
