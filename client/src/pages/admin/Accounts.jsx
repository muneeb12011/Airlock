import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { UserPlus, MoreHorizontal, Copy, KeyRound, Lock, Users } from "lucide-react";
import api from "../../api";
import useAuth from "../../store/auth";
import { toast } from "../../store/toast";
import { errorMessage } from "../../lib/download";
import { timeAgo, dateTime, ROLES } from "../../lib/format";
import useWorkspace from "../../store/workspace";
import { Avatar, Button, Callout, Empty, Field, Modal, Skeleton } from "../../components/ui";

function TempPassword({ result, onClose }) {
  const loginUrl = window.location.origin + "/login";
  const message = `Your Airlock account is ready.\nSign in at ${loginUrl}\nEmail: ${result.email}\nOne-time password: ${result.password}\nYou'll choose your own password when you sign in.`;
  const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => toast.ok(`${what} copied`));
  return (
    <Modal title={result.title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="muted" style={{ margin: 0 }}>
        Give {result.name} this one-time password over a channel you trust (in person, or a different app than email). It's shown only once — they'll replace it on first sign-in.
      </p>
      <div className="recovery-grid" style={{ gridTemplateColumns: "1fr", fontSize: 20, textAlign: "center", letterSpacing: "0.05em" }}>{result.password}</div>
      <div className="row wrap">
        <Button size="sm" icon={<Copy />} onClick={() => copy(result.password, "Password")}>Copy password</Button>
        <Button size="sm" icon={<Copy />} onClick={() => copy(message, "Sign-in instructions")}>Copy full sign-in message</Button>
      </div>
    </Modal>
  );
}

function PersonForm({ person, emailEnabled, onClose, onSaved }) {
  const { teams, loadTeams } = useWorkspace();
  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);
  const [form, setForm] = useState({
    name: person?.name || "",
    email: person?.email || "",
    title: person?.title || "",
    role: person?.role || "member",
    team_ids: (person?.teams || []).map((t) => String(t.id)),
    send_invite: true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name: form.name, title: form.title || null, role: form.role, team_ids: form.team_ids.map(Number) };
      const { data } = person
        ? await api.patch(`/users/${person.id}`, body)
        : await api.post("/users", { ...body, email: form.email, send_invite: emailEnabled && form.send_invite });
      useWorkspace.getState().loadPeople(true).catch(() => {});
      useWorkspace.getState().loadTeams(true).catch(() => {});
      onSaved(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't save."));
      setBusy(false);
    }
  };
  const toggleTeam = (id) => setForm((f) => ({ ...f, team_ids: f.team_ids.includes(id) ? f.team_ids.filter((x) => x !== id) : [...f.team_ids, id] }));
  return (
    <Modal
      title={person ? `Edit ${person.name}` : "Add a person"}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button type="submit" form="person-form" variant="primary" loading={busy}>{person ? "Save" : emailEnabled && form.send_invite ? "Send invite" : "Create account"}</Button></>}
    >
      <form id="person-form" className="form-grid" onSubmit={submit}>
        <Field label="Full name" htmlFor="ap-name">
          <input id="ap-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} />
        </Field>
        <Field label="Job title" htmlFor="ap-title">
          <input id="ap-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Content strategist" maxLength={100} />
        </Field>
        {!person && (
          <Field label="Work email" className="span-2" hint="This is what they sign in with." htmlFor="ap-email">
            <input id="ap-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
        )}
        <Field label="Role" className="span-2" htmlFor="ap-role">
          <select id="ap-role" className="select input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">Team member — works on assigned and project tasks</option>
            <option value="manager">Manager — runs projects: creates, assigns and reviews work</option>
            <option value="admin">Admin — everything, including people, security and settings</option>
          </select>
        </Field>
        {(teams || []).length > 0 && (
          <Field label="Teams" className="span-2">
            <div className="row wrap gap-8">
              {teams.map((t) => (
                <label key={t.id} className="pill" style={{ cursor: "pointer", height: 28 }}>
                  <input type="checkbox" checked={form.team_ids.includes(String(t.id))} onChange={() => toggleTeam(String(t.id))} /> {t.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        {!person && (
          <div className="span-2">
            {emailEnabled ? (
              <label className="row small" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={form.send_invite} onChange={(e) => setForm({ ...form, send_invite: e.target.checked })} />
                Email them an invite link to choose their own password (otherwise you'll get a one-time password to hand over)
              </label>
            ) : (
              <span className="small muted">Email isn't set up on the server, so you'll get a one-time password to hand over.</span>
            )}
          </div>
        )}
        {error && <div className="span-2"><Callout tone="bad">{error}</Callout></div>}
      </form>
    </Modal>
  );
}

function RowMenu({ user, me, onAction }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    if (!pos) return undefined;
    const close = (e) => !menu.current?.contains(e.target) && !btn.current?.contains(e.target) && setPos(null);
    const esc = (e) => e.key === "Escape" && setPos(null);
    const off = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [pos]);
  const self = user.id === me.id;
  const items = [
    !self && { key: "reset-password", label: "Reset password" },
    user.is_locked && { key: "unlock", label: "Unlock account" },
    user.totp_enabled && !self && { key: "reset-2fa", label: "Reset two-step sign-in" },
    !self && { key: "revoke", label: "Sign out of all devices" },
    { key: "edit", label: "Edit name, title, role and teams" },
    !self && { key: "invite", label: "Resend invite email" },
    !self && { key: "active", label: user.is_active ? "Disable account" : "Re-enable account" },
    !self && { key: "delete", label: "Delete permanently", danger: true },
  ].filter(Boolean);
  if (!items.length) return null;
  const toggle = (e) => {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const height = items.length * 38 + 12;
    const top = r.bottom + 6 + height > window.innerHeight ? Math.max(8, r.top - height - 6) : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) });
  };
  return (
    <>
      <span ref={btn}>
        <Button size="sm" variant="ghost" icon={<MoreHorizontal />} aria-label={`Actions for ${user.name}`} aria-expanded={!!pos} onClick={toggle} />
      </span>
      {pos &&
        createPortal(
          <div ref={menu} className="popover" style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto", width: 240, padding: 6 }} role="menu">
            {items.map((i) => (
              <button key={i.key} role="menuitem" type="button" className="nav-link" style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", color: i.danger ? "var(--breach)" : undefined }} onClick={() => { setPos(null); onAction(i.key, user); }}>
                {i.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

export default function Accounts() {
  const [users, setUsers] = useState(null);
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState(null);
  const [editing, setEditing] = useState(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  useEffect(() => {
    api.get("/auth/config").then(({ data }) => setEmailEnabled(data.email_enabled)).catch(() => {});
  }, []);
  const me = useAuth((s) => s.user);
  const navigate = useNavigate();

  const load = () => api.get("/users").then(({ data }) => setUsers(data)).catch(async (err) => toast.bad(await errorMessage(err)));
  useEffect(() => { load(); }, []);

  const action = async (key, u) => {
    try {
      if (key === "reset-password") {
        if (!window.confirm(`Reset ${u.name}'s password? They'll be signed out everywhere and need the new one-time password.`)) return;
        const { data } = await api.post(`/users/${u.id}/reset-password`);
        setTemp({ title: `New one-time password for ${u.name}`, name: u.name, email: u.email, password: data.temp_password });
      } else if (key === "unlock") {
        await api.post(`/users/${u.id}/unlock`);
        toast.ok(`${u.name} can sign in again`);
      } else if (key === "reset-2fa") {
        if (!window.confirm(`Turn off two-step sign-in for ${u.name}? Use this when they've lost their phone. They'll set it up again.`)) return;
        await api.post(`/users/${u.id}/reset-2fa`);
        toast.ok("Two-step sign-in reset");
      } else if (key === "revoke") {
        await api.post(`/users/${u.id}/revoke-sessions`);
        toast.ok(`${u.name} was signed out of every device`);
      } else if (key === "edit") {
        setEditing(u);
        return;
      } else if (key === "invite") {
        await api.post(`/users/${u.id}/invite`);
        toast.ok(`Invite sent to ${u.email}`);
      } else if (key === "active") {
        if (u.is_active && !window.confirm(`Disable ${u.name}? They're signed out immediately and can't sign in until re-enabled. Their tasks and history stay.`)) return;
        await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
        toast.ok(u.is_active ? "Account disabled" : "Account re-enabled");
      } else if (key === "delete") {
        const typed = window.prompt(`This permanently deletes ${u.name}, every task assigned to them, their messages and all their files.\n\nType their email to confirm:`);
        if (typed === null) return;
        if (typed.trim().toLowerCase() !== u.email) return toast.bad("Email didn't match — nothing was deleted.");
        await api.delete(`/users/${u.id}`);
        toast.ok(`${u.name} was deleted`);
      }
      load();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };

  const statusOf = (u) => {
    if (!u.is_active) return <span className="pill bad">Disabled</span>;
    if (u.is_locked) return <span className="pill bad"><Lock size={11} /> Locked</span>;
    if (u.must_change_password) return <span className="pill warn">Hasn't signed in yet</span>;
    return <span className="pill ok">Active</span>;
  };

  return (
    <div className="col gap-16">
      <div className="row between wrap">
        <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>Only people you add here can sign in. {emailEnabled ? "New people get an invite email to set their own password." : "New accounts get a one-time password that must be changed on first sign-in."}</p>
        <Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>Add person</Button>
      </div>

      {!users ? (
        <Skeleton h={200} />
      ) : users.length <= 1 ? (
        <div className="panel">
          <Empty icon={<Users />} title="It's just you so far" action={<Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>Add your first team member</Button>}>
            Add the people you work with. Each gets their own private task list and a direct line to you.
          </Empty>
        </div>
      ) : null}

      {users && users.length > 0 && (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr><th>Person</th><th>Role</th><th>Teams</th><th>Status</th><th>Two-step</th><th>Last sign-in</th><th className="num">Open</th><th className="num">Overdue</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => navigate(`/tasks?assignee=${u.id}`)} style={{ opacity: u.is_active ? 1 : 0.6 }}>
                  <td>
                    <span className="row gap-12">
                      <Avatar name={u.name} id={u.id} src={u.avatar_url} showPresence />
                      <span className="col" style={{ gap: 0, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{u.name}{u.id === me.id && <span className="faint"> (you)</span>}</span>
                        <span className="small muted">{u.email}{u.title ? ` · ${u.title}` : ""}</span>
                      </span>
                    </span>
                  </td>
                  <td><span className={`pill ${u.role === "admin" ? "in_review" : u.role === "manager" ? "in_progress" : ""}`}>{ROLES[u.role]}</span></td>
                  <td className="small">{(u.teams || []).map((t) => t.name).join(", ") || <span className="faint">—</span>}</td>
                  <td>{statusOf(u)}</td>
                  <td>{u.totp_enabled ? <span className="pill ok"><KeyRound size={11} /> On</span> : <span className="pill">Off</span>}</td>
                  <td className="small muted nowrap" title={dateTime(u.last_login_at)}>{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</td>
                  <td className="num">{u.open_tasks + u.in_review}</td>
                  <td className="num" style={{ color: u.overdue_tasks ? "var(--breach)" : undefined }}>{u.overdue_tasks}</td>
                  <td onClick={(e) => e.stopPropagation()}><RowMenu user={u} me={me} onAction={action} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <PersonForm
          emailEnabled={emailEnabled}
          onClose={() => setAdding(false)}
          onSaved={(data) => {
            setAdding(false);
            if (data.invited) toast.ok(`Invite sent to ${data.user.email}`);
            else setTemp({ title: `${data.user.name} can now sign in`, name: data.user.name, email: data.user.email, password: data.temp_password });
            load();
          }}
        />
      )}
      {editing && <PersonForm person={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.ok("Saved"); load(); }} />}
      {temp && <TempPassword result={temp} onClose={() => setTemp(null)} />}
    </div>
  );
}
