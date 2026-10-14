import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Settings2, UserPlus, Repeat, Play, Trash2, Archive, ArchiveRestore, Plus, X } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { KINDS, PRIORITIES, TYPES, shortDate, isAdmin } from "../lib/format";
import { Avatar, Button, Callout, Empty, Field, Modal, Skeleton, TaskKey } from "../components/ui";
import TaskWorkspace from "../components/TaskViews";
import { ProjectForm } from "./Projects";

const RECUR = { none: "Manual only", daily: "Every day", weekly: "Every week", monthly: "Every month" };

function People({ project, reload }) {
  const { people, teams, loadPeople, loadTeams } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const [team, setTeam] = useState("");
  const me = useAuth((s) => s.user);
  useEffect(() => {
    loadPeople().catch(() => {});
    loadTeams().catch(() => {});
  }, [loadPeople, loadTeams]);
  const ids = new Set(project.members.map((m) => m.id));

  const add = async () => {
    try {
      const { data } = await api.post(`/projects/${project.id}/members`, { user_ids: pick ? [Number(pick)] : [], team_id: team ? Number(team) : undefined });
      toast.ok(`Added ${data.added} ${data.added === 1 ? "person" : "people"}`);
      setPick(""); setTeam(""); setAdding(false);
      reload();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async (m) => {
    if (!window.confirm(m.id === me.id ? "Leave this project?" : `Remove ${m.name} from ${project.name}? Their tasks stay, but they'll lose access to teammates' tasks here.`)) return;
    try {
      await api.delete(`/projects/${project.id}/members/${m.id}`);
      reload();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };

  return (
    <div className="col gap-12" style={{ maxWidth: 860 }}>
      {project.can_manage && (
        adding ? (
          <div className="panel panel-body row wrap gap-12">
            <select className="select input" style={{ width: "auto" }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Person">
              <option value="">Add a person…</option>
              {(people || []).filter((p) => !ids.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="muted small">or</span>
            <select className="select input" style={{ width: "auto" }} value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
              <option value="">Add a whole team…</option>
              {(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.members.length})</option>)}
            </select>
            <Button variant="primary" disabled={!pick && !team} onClick={add}>Add</Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        ) : (
          <div><Button icon={<UserPlus />} onClick={() => setAdding(true)}>Add people</Button></div>
        )
      )}
      <div className="panel table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th className="num">Open</th><th className="num">Done</th><th /></tr></thead>
          <tbody>
            {project.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="row gap-12">
                    <Avatar name={m.name} id={m.id} src={m.avatar_url} showPresence />
                    <span className="col" style={{ gap: 0 }}>
                      <b>{m.name}{m.id === project.owner_id && <span className="faint small"> · owner</span>}</b>
                      <span className="small muted">{m.title || (m.role === "member" ? "Team member" : m.role)}</span>
                    </span>
                  </span>
                </td>
                <td className="num">{m.open}</td>
                <td className="num">{m.done}</td>
                <td style={{ textAlign: "right" }}>
                  {(project.can_manage || m.id === me.id) && m.id !== project.owner_id && (
                    <Button size="sm" variant="ghost" icon={<X />} aria-label={`Remove ${m.name}`} onClick={() => remove(m)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplateForm({ project, template, onClose, onSaved }) {
  const { people, loadPeople } = useWorkspace();
  const settings = useAuth((s) => s.settings);
  useEffect(() => { loadPeople().catch(() => {}); }, [loadPeople]);
  const [f, setF] = useState({
    title: template?.title || "",
    description: template?.description || "",
    type: template?.type || (project.kind === "marketing" ? "content" : "feature"),
    priority: template?.priority || "medium",
    assignee_id: template?.assignee_id ? String(template.assignee_id) : "",
    recurrence: template?.recurrence || "weekly",
    due_in_days: template?.due_in_days ?? 3,
    channel: template?.channel || "",
    checklist: (template?.checklist || []).join("\n"),
    labels: (template?.labels || []).join(", "),
    active: template?.active ?? true,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        title: f.title,
        description: f.description || null,
        type: f.type,
        priority: f.priority,
        assignee_id: f.assignee_id ? Number(f.assignee_id) : null,
        recurrence: f.recurrence,
        due_in_days: Number(f.due_in_days),
        channel: f.channel || null,
        checklist: f.checklist.split("\n").map((s) => s.trim()).filter(Boolean),
        labels: f.labels.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        active: f.active,
      };
      const { data } = template
        ? await api.patch(`/projects/${project.id}/templates/${template.id}`, body)
        : await api.post(`/projects/${project.id}/templates`, body);
      onSaved(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't save the template."));
      setBusy(false);
    }
  };
  return (
    <Modal title={template ? "Edit template" : "New template"} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="tpl-form" loading={busy}>Save template</Button></>}>
      <form id="tpl-form" className="form-grid" onSubmit={submit}>
        <Field label="Task title" className="span-2" htmlFor="tp-title"><input id="tp-title" className="input" value={f.title} onChange={set("title")} required minLength={3} placeholder="Weekly newsletter" /></Field>
        <Field label="Repeats" htmlFor="tp-rec">
          <select id="tp-rec" className="select input" value={f.recurrence} onChange={set("recurrence")}>
            {Object.entries(RECUR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Due after (days)" htmlFor="tp-due"><input id="tp-due" className="input" type="number" min={0} max={365} value={f.due_in_days} onChange={set("due_in_days")} /></Field>
        <Field label="Assign to" htmlFor="tp-who" hint="Required for repeating tasks.">
          <select id="tp-who" className="select input" value={f.assignee_id} onChange={set("assignee_id")}>
            <option value="">Choose when running</option>
            {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Priority" htmlFor="tp-prio">
          <select id="tp-prio" className="select input" value={f.priority} onChange={set("priority")}>
            {Object.entries(PRIORITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Type" htmlFor="tp-type">
          <select id="tp-type" className="select input" value={f.type} onChange={set("type")}>
            {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Channel" htmlFor="tp-ch">
          <select id="tp-ch" className="select input" value={f.channel} onChange={set("channel")}>
            <option value="">None</option>
            {(settings.channels || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Details" className="span-2" htmlFor="tp-desc"><textarea id="tp-desc" className="textarea" rows={3} value={f.description} onChange={set("description")} /></Field>
        <Field label="Checklist" className="span-2" hint="One item per line." htmlFor="tp-check"><textarea id="tp-check" className="textarea" rows={3} value={f.checklist} onChange={set("checklist")} /></Field>
        <Field label="Labels" className="span-2" hint="Comma-separated." htmlFor="tp-labels"><input id="tp-labels" className="input" value={f.labels} onChange={set("labels")} /></Field>
        <label className="row small span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} /> Active</label>
        {error && <div className="span-2"><Callout tone="bad">{error}</Callout></div>}
      </form>
    </Modal>
  );
}

function Templates({ project }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get(`/projects/${project.id}/templates`).then(({ data }) => setList(data)).catch(() => setList([])), [project.id]);
  useEffect(() => { load(); }, [load]);
  const run = async (t) => {
    try {
      const { data } = await api.post(`/projects/${project.id}/templates/${t.id}/run`, {});
      toast.ok(`${data.key} created for ${data.assignee_name}`);
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async (t) => {
    if (!window.confirm(`Delete the template “${t.title}”? Tasks already created stay.`)) return;
    await api.delete(`/projects/${project.id}/templates/${t.id}`).catch(() => {});
    load();
  };
  return (
    <div className="col gap-12" style={{ maxWidth: 860 }}>
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0, maxWidth: "60ch" }}>
          Templates turn routine work into one click — or into a task that appears on its own every day, week or month (newsletters, reports, dependency updates).
        </p>
        {project.can_manage && <Button variant="primary" icon={<Plus />} onClick={() => setEditing({})}>New template</Button>}
      </div>
      {!list ? <Skeleton h={80} /> : list.length === 0 ? (
        <div className="panel"><Empty icon={<Repeat />} title="No templates yet">Create one for work your team repeats.</Empty></div>
      ) : (
        <div className="panel panel-list">
          {list.map((t) => (
            <div key={t.id} className="panel-body row between wrap gap-12" style={{ opacity: t.active ? 1 : 0.6 }}>
              <div className="col gap-4" style={{ minWidth: 0 }}>
                <b>{t.title}</b>
                <span className="small muted">
                  {RECUR[t.recurrence]}{t.recurrence !== "none" && t.next_run_on ? ` · next ${shortDate(t.next_run_on)}` : ""}
                  {t.assignee_name ? ` · ${t.assignee_name}` : ""} · due after {t.due_in_days} day{t.due_in_days === 1 ? "" : "s"}
                  {t.checklist?.length ? ` · ${t.checklist.length}-item checklist` : ""}
                </span>
              </div>
              {project.can_manage && (
                <div className="row">
                  <Button size="sm" icon={<Play />} onClick={() => run(t)} disabled={!t.assignee_id}>Create now</Button>
                  <Button size="sm" onClick={() => setEditing(t)}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${t.title}`} onClick={() => remove(t)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && (
        <TemplateForm project={project} template={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.ok("Template saved"); load(); }} />
      )}
    </div>
  );
}

export default function Project() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const tab = params.get("tab") || "tasks";

  const load = useCallback(() => {
    api.get(`/projects/${id}`).then(({ data }) => setProject(data)).catch(async (err) => setError(await errorMessage(err, "Couldn't open this project.")));
  }, [id]);
  useEffect(load, [load]);

  const setTab = (t) => setParams(t === "tasks" ? {} : { tab: t });
  const archive = async (status) => {
    try {
      await api.patch(`/projects/${id}`, { status });
      toast.ok(status === "archived" ? "Project archived" : "Project restored");
      useWorkspace.getState().loadProjects(true).catch(() => {});
      load();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${project.name}? Only empty projects can be deleted.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      useWorkspace.getState().loadProjects(true).catch(() => {});
      navigate("/projects");
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };

  if (error) return <Callout tone="bad">{error} <Link to="/projects">Back to projects</Link></Callout>;
  if (!project) return <Skeleton h={120} />;
  const pct = project.task_count ? Math.round((project.done_count / project.task_count) * 100) : 0;

  return (
    <div className="col gap-16">
      <Link to="/projects" className="small row gap-4" style={{ textDecoration: "none" }}><ArrowLeft size={14} /> Projects</Link>
      <div className="panel panel-body col gap-12" style={{ borderTop: `4px solid ${project.color}` }}>
        <div className="row between wrap gap-12">
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <div className="row gap-8">
              <TaskKey k={project.key} color={project.color} />
              <span className="kind-tag">{KINDS[project.kind]}</span>
              {project.status === "archived" && <span className="pill warn">Archived</span>}
            </div>
            <h2 className="h1">{project.name}</h2>
            {project.goal && <span className="muted">{project.goal}</span>}
          </div>
          {project.can_manage && (
            <div className="row wrap">
              <Button size="sm" icon={<Settings2 />} onClick={() => setEditing(true)}>Settings</Button>
              {project.status === "active"
                ? <Button size="sm" icon={<Archive />} onClick={() => archive("archived")}>Archive</Button>
                : <Button size="sm" icon={<ArchiveRestore />} onClick={() => archive("active")}>Restore</Button>}
              {isAdmin(user) && <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label="Delete project" onClick={remove} />}
            </div>
          )}
        </div>
        {project.description && <div className="prose small">{project.description}</div>}
        <div className="row wrap gap-24 small muted">
          <span><b style={{ color: "var(--ink)" }}>{pct}%</b> done ({project.done_count}/{project.task_count})</span>
          {project.review_count > 0 && <span><b style={{ color: "var(--signal)" }}>{project.review_count}</b> in review</span>}
          {project.overdue_count > 0 && <span><b style={{ color: "var(--breach)" }}>{project.overdue_count}</b> overdue</span>}
          {(project.start_date || project.end_date) && <span>{project.start_date ? shortDate(project.start_date) : "…"} → {project.end_date ? shortDate(project.end_date) : "…"}</span>}
          {project.team_name && <span>Team: {project.team_name}</span>}
          <span className="avatar-stack" aria-label={`${project.member_count} people`}>
            {project.members.slice(0, 6).map((m) => <Avatar key={m.id} name={m.name} id={m.id} src={m.avatar_url} size="sm" />)}
          </span>
        </div>
        <div className="meter"><i style={{ width: `${pct}%`, background: "var(--seal)" }} /></div>
      </div>

      <div className="tabs" role="tablist">
        {[["tasks", "Tasks"], ["people", `People (${project.member_count})`], ["templates", "Templates & recurring"]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "tasks" && <TaskWorkspace projectId={project.id} project={project} defaultView={project.kind === "marketing" ? "calendar" : "board"} />}
      {tab === "people" && <People project={project} reload={load} />}
      {tab === "templates" && <Templates project={project} />}

      {editing && <ProjectForm project={project} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.ok("Project saved"); load(); }} />}
    </div>
  );
}
