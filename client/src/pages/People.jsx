import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, MessageSquare, Plus, Users, Pencil, Trash2 } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { ROLES, isAdmin } from "../lib/format";
import { Avatar, Button, Callout, Empty, Field, Modal, Skeleton } from "../components/ui";

const Accounts = lazy(() => import("./admin/Accounts"));
const COLORS = ["#0e5f50", "#2f5aa8", "#9a3412", "#7c3aed", "#b42318", "#0369a1", "#a16207", "#be185d"];

function localTime(tz) {
  if (!tz) return null;
  try {
    return new Date().toLocaleTimeString(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

function Directory() {
  const { people, loadPeople } = useWorkspace();
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  useEffect(() => { loadPeople(true).catch(() => {}); }, [loadPeople]);
  const teams = useMemo(() => [...new Map((people || []).flatMap((p) => p.teams).map((t) => [t.id, t])).values()], [people]);
  const shown = (people || []).filter(
    (p) => (!q || `${p.name} ${p.title || ""}`.toLowerCase().includes(q.toLowerCase())) && (!team || p.teams.some((t) => String(t.id) === team))
  );
  if (!people) return <Skeleton h={200} />;
  return (
    <div className="col gap-16">
      <div className="row wrap gap-12">
        <div className="search" style={{ width: "min(320px, 100%)" }}>
          <Search />
          <input className="input" placeholder="Search by name or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </div>
        {teams.length > 0 && (
          <select className="select input" style={{ width: "auto" }} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <div className="project-grid">
        {shown.map((p) => (
          <div key={p.id} className="panel panel-body col gap-12">
            <div className="row gap-12">
              <Avatar name={p.name} id={p.id} src={p.avatar_url} size="lg" showPresence />
              <div className="col" style={{ gap: 0, minWidth: 0 }}>
                <b className="ellipsis">{p.name}{p.id === me.id && <span className="faint"> (you)</span>}</b>
                <span className="small muted ellipsis">{p.title || ROLES[p.role]}</span>
              </div>
            </div>
            <div className="row wrap gap-8 small muted">
              {p.role !== "member" && <span className="pill">{ROLES[p.role]}</span>}
              {p.teams.map((t) => <span key={t.id} className="pill" style={{ borderColor: t.color }}>{t.name}</span>)}
              {localTime(p.timezone) && <span>{localTime(p.timezone)} local</span>}
            </div>
            {p.id !== me.id && (
              <div><Button size="sm" icon={<MessageSquare />} onClick={() => navigate(`/messages?with=${p.id}`)}>Message</Button></div>
            )}
          </div>
        ))}
      </div>
      {shown.length === 0 && <Empty title="No one matches">Try another name or team.</Empty>}
    </div>
  );
}

function TeamForm({ team, onClose, onSaved }) {
  const { people, loadPeople } = useWorkspace();
  const me = useAuth((s) => s.user);
  const admin = isAdmin(me);
  useEffect(() => { loadPeople().catch(() => {}); }, [loadPeople]);
  const [f, setF] = useState({
    name: team?.name || "",
    description: team?.description || "",
    color: team?.color || COLORS[0],
    lead_id: team?.lead_id ? String(team.lead_id) : "",
    member_ids: (team?.members || []).map((m) => m.id),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = admin
        ? { name: f.name, description: f.description || null, color: f.color, lead_id: f.lead_id ? Number(f.lead_id) : null, member_ids: f.member_ids }
        : { member_ids: f.member_ids };
      team ? await api.patch(`/teams/${team.id}`, body) : await api.post("/teams", body);
      useWorkspace.getState().loadTeams(true).catch(() => {});
      useWorkspace.getState().loadPeople(true).catch(() => {});
      onSaved();
    } catch (err) {
      setError(await errorMessage(err, "Couldn't save the team."));
      setBusy(false);
    }
  };
  const toggle = (id) => setF((x) => ({ ...x, member_ids: x.member_ids.includes(id) ? x.member_ids.filter((i) => i !== id) : [...x.member_ids, id] }));
  return (
    <Modal title={team ? `Edit ${team.name}` : "New team"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="team-form" loading={busy}>Save team</Button></>}>
      <form id="team-form" className="form-grid" onSubmit={submit}>
        {admin && (
          <>
            <Field label="Name" htmlFor="tm-name"><input id="tm-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} placeholder="Marketing" /></Field>
            <Field label="Lead" htmlFor="tm-lead">
              <select id="tm-lead" className="select input" value={f.lead_id} onChange={(e) => setF({ ...f, lead_id: e.target.value })}>
                <option value="">No lead</option>
                {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Description" className="span-2" htmlFor="tm-desc"><input id="tm-desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} /></Field>
            <Field label="Colour" className="span-2">
              <div className="row wrap gap-4" role="radiogroup" aria-label="Team colour">
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} onClick={() => setF({ ...f, color: c })}
                    style={{ width: 26, height: 26, borderRadius: 7, background: c, border: f.color === c ? "3px solid var(--ink)" : "2px solid var(--panel)", cursor: "pointer" }} />
                ))}
              </div>
            </Field>
          </>
        )}
        <Field label={`Members (${f.member_ids.length})`} className="span-2">
          <div className="col" style={{ maxHeight: 260, overflowY: "auto", gap: 2, border: "1px solid var(--line-soft)", borderRadius: 8, padding: 6 }}>
            {(people || []).map((p) => (
              <label key={p.id} className="check-item" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={f.member_ids.includes(p.id)} onChange={() => toggle(p.id)} />
                <Avatar name={p.name} id={p.id} src={p.avatar_url} size="sm" />
                <span className="grow">{p.name}<span className="small muted">{p.title ? ` — ${p.title}` : ""}</span></span>
              </label>
            ))}
          </div>
        </Field>
        {error && <div className="span-2"><Callout tone="bad">{error}</Callout></div>}
      </form>
    </Modal>
  );
}

function Teams() {
  const { teams, loadTeams } = useWorkspace();
  const [editing, setEditing] = useState(null);
  const me = useAuth((s) => s.user);
  useEffect(() => { loadTeams(true).catch(() => {}); }, [loadTeams]);
  const remove = async (t) => {
    if (!window.confirm(`Delete the ${t.name} team? People and projects stay; only the grouping goes.`)) return;
    try {
      await api.delete(`/teams/${t.id}`);
      loadTeams(true);
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  if (!teams) return <Skeleton h={160} />;
  return (
    <div className="col gap-16">
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0, maxWidth: "60ch" }}>Teams group people by function. Add a team to a project and everyone on it joins; teammates can message each other.</p>
        {isAdmin(me) && <Button variant="primary" icon={<Plus />} onClick={() => setEditing({})}>New team</Button>}
      </div>
      {teams.length === 0 ? (
        <div className="panel"><Empty icon={<Users />} title="No teams yet">{isAdmin(me) ? "Create teams like Marketing, Engineering or Design." : "Your admin hasn't set up teams yet."}</Empty></div>
      ) : (
        <div className="project-grid">
          {teams.map((t) => (
            <div key={t.id} className="panel project-card" style={{ "--pc": t.color }}>
              <div className="row between">
                <span className="h2">{t.name}</span>
                {(isAdmin(me) || t.lead_id === me.id) && (
                  <span className="row gap-4">
                    <Button size="sm" variant="ghost" icon={<Pencil />} aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)} />
                    {isAdmin(me) && <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${t.name}`} onClick={() => remove(t)} />}
                  </span>
                )}
              </div>
              {t.description && <span className="small muted">{t.description}</span>}
              <span className="avatar-stack">{t.members.slice(0, 8).map((m) => <Avatar key={m.id} name={m.name} id={m.id} src={m.avatar_url} size="sm" />)}</span>
              <span className="small muted">{t.members.length} {t.members.length === 1 ? "person" : "people"}{t.lead_name ? ` · led by ${t.lead_name}` : ""}{t.project_count ? ` · ${t.project_count} active project${t.project_count === 1 ? "" : "s"}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {editing && <TeamForm team={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.ok("Team saved"); loadTeams(true); }} />}
    </div>
  );
}

export default function People() {
  const [params, setParams] = useSearchParams();
  const me = useAuth((s) => s.user);
  const tabs = [["directory", "Directory"], ["teams", "Teams"], ...(isAdmin(me) ? [["accounts", "Accounts"]] : [])];
  const tab = tabs.some(([k]) => k === params.get("tab")) ? params.get("tab") : "directory";
  return (
    <div className="col gap-16">
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === "directory" ? {} : { tab: k })}>{l}</button>)}
      </div>
      {tab === "directory" && <Directory />}
      {tab === "teams" && <Teams />}
      {tab === "accounts" && <Suspense fallback={<Skeleton h={200} />}><Accounts /></Suspense>}
    </div>
  );
}
