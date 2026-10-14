import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, Trash2, Plus, KeyRound, Download, Copy } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { download, errorMessage } from "../lib/download";
import { ROLES, dateTime, timeAgo } from "../lib/format";
import { API_URL } from "../lib/config";
import { Avatar, Button, Callout, Empty, Field, Modal, Skeleton, Switch } from "../components/ui";

const SecuritySection = lazy(() => import("./Account"));

const ZONES = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Karachi", "Asia/Dubai", "Europe/London", "America/New_York", "America/Los_Angeles"];
  }
})();

function ProfileForm() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const [form, setForm] = useState({ name: user.name, title: user.title || "", bio: user.bio || "", timezone: user.timezone || "" });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [teams, setTeams] = useState([]);
  const file = useRef(null);
  useEffect(() => { api.get("/me").then(({ data }) => setTeams(data.teams)).catch(() => {}); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch("/me", { ...form, title: form.title || null, bio: form.bio || null, timezone: form.timezone || null });
      setSession({ user: data.user });
      useWorkspace.getState().loadPeople(true).catch(() => {});
      toast.ok("Profile saved");
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (f) => {
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const { data } = await api.post("/me/avatar", fd);
      setSession({ user: data.user });
      useWorkspace.getState().loadPeople(true).catch(() => {});
      toast.ok("Photo updated");
    } catch (err) {
      toast.bad(await errorMessage(err, "Couldn't upload that image."));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };
  const removePhoto = async () => {
    const { data } = await api.delete("/me/avatar");
    setSession({ user: data.user });
    useWorkspace.getState().loadPeople(true).catch(() => {});
  };
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <form className="panel" style={{ maxWidth: 760 }} onSubmit={save}>
      <div className="panel-body row gap-16 wrap" style={{ borderBottom: "1px solid var(--line-soft)" }}>
        <Avatar name={user.name} id={user.id} src={user.avatar_url} size="xl" />
        <div className="col gap-8">
          <div className="row wrap">
            <Button icon={<Camera />} loading={uploading} onClick={() => file.current?.click()}>{user.avatar_url ? "Change photo" : "Upload photo"}</Button>
            {user.avatar_url && <Button variant="ghost" icon={<Trash2 />} onClick={removePhoto}>Remove</Button>}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files[0])} />
          </div>
          <span className="tiny muted">PNG, JPEG or WebP, up to 3 MB. Checked by File Shield like any upload.</span>
        </div>
        <div className="col gap-4" style={{ marginLeft: "auto" }}>
          <span className="small muted">{user.email}</span>
          <span className="small"><b>{ROLES[user.role]}</b>{teams.length ? ` · ${teams.map((t) => t.name + (t.is_lead ? " (lead)" : "")).join(", ")}` : ""}</span>
        </div>
      </div>
      <div className="panel-body form-grid">
        <Field label="Full name" htmlFor="pr-name"><input id="pr-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={100} /></Field>
        <Field label="Job title" htmlFor="pr-title"><input id="pr-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={100} placeholder="Frontend engineer" /></Field>
        <Field label="Time zone" htmlFor="pr-tz" hint={form.timezone !== browserZone ? <button type="button" className="btn ghost sm" style={{ padding: 0, height: "auto" }} onClick={() => setForm({ ...form, timezone: browserZone })}>Use this device's: {browserZone}</button> : "Teammates see your local time on your profile."}>
          <select id="pr-tz" className="select input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
            <option value="">Not set</option>
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <div />
        <Field label="About you" className="span-2" htmlFor="pr-bio" hint="What you work on, how you like to be reached. Up to 600 characters.">
          <textarea id="pr-bio" className="textarea" rows={3} maxLength={600} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <div className="span-2"><Button type="submit" variant="primary" loading={busy}>Save profile</Button></div>
      </div>
    </form>
  );
}

const PREFS = [
  ["email_assigned", "Work assigned to me", "New tasks, reassignments and tasks I'm given from templates."],
  ["email_review", "Reviews", "Submissions waiting for my review, and approvals or change requests on my work."],
  ["email_mention", "Mentions", "When someone @mentions me in a comment."],
  ["email_security", "Security alerts", "New-network sign-ins, account lockouts, recovery code use. Strongly recommended."],
];

function Notifications() {
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const [emailOn, setEmailOn] = useState(null);
  useEffect(() => { api.get("/auth/config").then(({ data }) => setEmailOn(data.email_enabled)).catch(() => {}); }, []);
  const set = async (k, v) => {
    try {
      const { data } = await api.patch("/me", { notify_prefs: { [k]: v } });
      setSession({ user: data.user });
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  return (
    <div className="col gap-12" style={{ maxWidth: 760 }}>
      {emailOn === false && <Callout tone="warn">Email isn't configured on this server yet, so these only take effect once your admin sets it up. In-app notifications always work.</Callout>}
      <div className="panel panel-list">
        {PREFS.map(([k, label, hint]) => (
          <div key={k} className="panel-body row top gap-16">
            <div className="grow col gap-4"><span className="h3">{label}</span><span className="small muted">{hint}</span></div>
            <Switch label={`Email me about ${label.toLowerCase()}`} checked={user.notify_prefs?.[k] !== false} onChange={(v) => set(k, v)} />
          </div>
        ))}
      </div>
      <span className="small muted">You always get every notification in the bell inside the app. These switches only control email.</span>
    </div>
  );
}

function Tokens() {
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState(null);
  const [form, setForm] = useState({ name: "", scope: "read", expires_in_days: 90 });
  const load = () => api.get("/me/tokens").then(({ data }) => setList(data)).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const create = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/me/tokens", { ...form, expires_in_days: form.expires_in_days === "never" ? null : Number(form.expires_in_days) });
      setCreating(false);
      setMade(data);
      setForm({ name: "", scope: "read", expires_in_days: 90 });
      load();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const revoke = async (t) => {
    if (!window.confirm(`Revoke “${t.name}”? Anything using it stops working immediately.`)) return;
    await api.delete(`/me/tokens/${t.id}`).catch(() => {});
    load();
  };
  return (
    <div className="col gap-16" style={{ maxWidth: 860 }}>
      <div className="row between wrap">
        <p className="small muted" style={{ margin: 0, maxWidth: "60ch" }}>
          Personal tokens let scripts, CI pipelines and integrations use the API as you. Read tokens can only fetch data; write tokens can also comment, update checklists and change tasks you're allowed to change. Tokens can never change your password, two-step sign-in or other tokens.
        </p>
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New token</Button>
      </div>
      {!list ? <Skeleton h={100} /> : list.length === 0 ? (
        <div className="panel"><Empty icon={<KeyRound />} title="No tokens">Create one for each script or tool, so you can revoke them separately.</Empty></div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Access</th><th>Last used</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} style={{ opacity: t.revoked_at ? 0.5 : 1 }}>
                  <td><b>{t.name}</b><div className="mono tiny muted">{t.prefix}…</div></td>
                  <td><span className={`pill ${t.scope === "write" ? "warn" : ""}`}>{t.scope === "write" ? "Read & write" : "Read only"}</span></td>
                  <td className="small">{t.last_used_at ? <>{timeAgo(t.last_used_at)}<div className="tiny muted mono">{t.last_used_ip}</div></> : <span className="muted">Never</span>}</td>
                  <td className="small">{t.revoked_at ? "Revoked" : t.expires_at ? dateTime(t.expires_at) : "Never"}</td>
                  <td style={{ textAlign: "right" }}>{!t.revoked_at && <Button size="sm" variant="danger" onClick={() => revoke(t)}>Revoke</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel panel-body small col gap-8">
        <b>Example</b>
        <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{`curl -H "Authorization: Bearer alk_…" ${API_URL}/tasks?assignee=me&status=open`}</code>
      </div>
      {creating && (
        <Modal title="New API token" onClose={() => setCreating(false)} footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" form="tok-form">Create token</Button></>}>
          <form id="tok-form" className="col gap-16" onSubmit={create}>
            <Field label="Name" htmlFor="tk-name" hint="What will use it? e.g. “GitHub Actions — deploy notes”"><input id="tk-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} /></Field>
            <Field label="Access" htmlFor="tk-scope">
              <select id="tk-scope" className="select input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="read">Read only</option>
                <option value="write">Read & write</option>
              </select>
            </Field>
            <Field label="Expires" htmlFor="tk-exp">
              <select id="tk-exp" className="select input" value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: e.target.value })}>
                <option value={7}>In 7 days</option><option value={30}>In 30 days</option><option value={90}>In 90 days</option><option value={365}>In a year</option><option value="never">Never (not recommended)</option>
              </select>
            </Field>
          </form>
        </Modal>
      )}
      {made && (
        <Modal title="Copy your token now" onClose={() => setMade(null)} footer={<Button variant="primary" onClick={() => setMade(null)}>Done</Button>}>
          <Callout tone="warn">This is the only time it's shown. Store it in your CI secrets or a password manager — treat it like a password.</Callout>
          <div className="recovery-grid" style={{ gridTemplateColumns: "1fr", wordBreak: "break-all" }}>{made.token}</div>
          <div><Button size="sm" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(made.token).then(() => toast.ok("Token copied"))}>Copy token</Button></div>
        </Modal>
      )}
    </div>
  );
}

function Data() {
  const [busy, setBusy] = useState(false);
  const exportData = async () => {
    setBusy(true);
    try {
      await download("/me/export", "my-data.json");
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel panel-body col gap-12" style={{ maxWidth: 760 }}>
      <h2 className="h2">Download your data</h2>
      <p className="muted" style={{ margin: 0 }}>A JSON file with your profile, the tasks assigned to you, your comments, your messages, your sign-in history and your notifications.</p>
      <div><Button icon={<Download />} loading={busy} onClick={exportData}>Download my data</Button></div>
      <p className="small muted" style={{ margin: 0 }}>To delete your account, ask an admin. Deleting removes your messages and the tasks assigned to you; the audit log keeps a record that it happened.</p>
    </div>
  );
}

const TABS = [["profile", "Profile"], ["notifications", "Notifications"], ["security", "Sign-in & security"], ["tokens", "API tokens"], ["data", "Your data"]];

export default function Profile() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "profile";
  return (
    <div className="col gap-16">
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === "profile" ? {} : { tab: k })}>{l}</button>)}
      </div>
      {tab === "profile" && <ProfileForm />}
      {tab === "notifications" && <Notifications />}
      {tab === "security" && <Suspense fallback={<Skeleton h={200} />}><SecuritySection /></Suspense>}
      {tab === "tokens" && <Tokens />}
      {tab === "data" && <Data />}
    </div>
  );
}
