import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, FolderKanban } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { KINDS, isLead, shortDate } from "../lib/format";
import { Button, Callout, Empty, Field, Modal, Segmented, Skeleton, TaskKey } from "../components/ui";

const COLORS = ["#2f5aa8", "#0e5f50", "#9a3412", "#7c3aed", "#b42318", "#0369a1", "#a16207", "#be185d"];

export function ProjectForm({ project, onClose, onSaved }) {
  const { teams, people, loadTeams, loadPeople } = useWorkspace();
  useEffect(() => {
    loadTeams().catch(() => {});
    loadPeople().catch(() => {});
  }, [loadTeams, loadPeople]);
  const [form, setForm] = useState({
    key: project?.key || "",
    name: project?.name || "",
    description: project?.description || "",
    kind: project?.kind || "general",
    color: project?.color || COLORS[0],
    team_id: project?.team_id ? String(project.team_id) : "",
    goal: project?.goal || "",
    start_date: project?.start_date || "",
    end_date: project?.end_date || "",
    member_ids: [],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const suggestKey = (name) =>
    name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4) ||
    name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        team_id: form.team_id ? Number(form.team_id) : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        member_ids: form.member_ids.map(Number),
      };
      delete body.keyTouched;
      if (project) delete body.member_ids;
      const { data } = project ? await api.patch(`/projects/${project.id}`, body) : await api.post("/projects", body);
      useWorkspace.getState().loadProjects(true).catch(() => {});
      onSaved(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't save the project."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={project ? "Project settings" : "New project"}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="project-form" loading={busy}>{project ? "Save" : "Create project"}</Button></>}
    >
      <form id="project-form" className="form-grid" onSubmit={submit}>
        <Field label="Name" className="span-2" htmlFor="pf-name">
          <input
            id="pf-name"
            className="input"
            value={form.name}
            required
            minLength={2}
            maxLength={120}
            placeholder="Spring launch campaign"
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, key: project || f.keyTouched ? f.key : suggestKey(name) }));
            }}
          />
        </Field>
        <Field label="Key" htmlFor="pf-key" hint="Prefix for task references, e.g. MKT-12.">
          <input id="pf-key" className="input mono" value={form.key} required pattern="[A-Za-z][A-Za-z0-9]{1,7}" maxLength={8} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase(), keyTouched: true }))} />
        </Field>
        <Field label="Kind" htmlFor="pf-kind" hint="Tunes the task form: channels for marketing, points for engineering.">
          <select id="pf-kind" className="select input" value={form.kind} onChange={set("kind")}>
            {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Goal" className="span-2" htmlFor="pf-goal" hint="One line everyone on the project can rally around.">
          <input id="pf-goal" className="input" value={form.goal} onChange={set("goal")} maxLength={500} placeholder="1,000 sign-ups from the launch by 30 Nov" />
        </Field>
        <Field label="Description" className="span-2" htmlFor="pf-desc">
          <textarea id="pf-desc" className="textarea" rows={3} value={form.description} onChange={set("description")} maxLength={5000} />
        </Field>
        <Field label="Start" htmlFor="pf-start"><input id="pf-start" className="input" type="date" value={form.start_date} onChange={set("start_date")} /></Field>
        <Field label="Target end" htmlFor="pf-end"><input id="pf-end" className="input" type="date" value={form.end_date} onChange={set("end_date")} /></Field>
        <Field label="Team" htmlFor="pf-team" hint={project ? undefined : "Everyone on the team joins the project."}>
          <select id="pf-team" className="select input" value={form.team_id} onChange={set("team_id")}>
            <option value="">No team</option>
            {(teams || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Colour">
          <div className="row wrap gap-4" role="radiogroup" aria-label="Project colour">
            {COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                style={{ width: 26, height: 26, borderRadius: 7, background: c, border: form.color === c ? "3px solid var(--ink)" : "2px solid var(--panel)", cursor: "pointer" }} />
            ))}
          </div>
        </Field>
        {!project && (
          <Field label="Also add" className="span-2" hint="Hold Ctrl / ⌘ to pick several.">
            <select className="input" multiple size={Math.min(6, (people || []).length || 3)} style={{ height: "auto", padding: 6 }} value={form.member_ids}
              onChange={(e) => setForm((f) => ({ ...f, member_ids: [...e.target.selectedOptions].map((o) => o.value) }))} aria-label="Project members">
              {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ""}</option>)}
            </select>
          </Field>
        )}
        {error && <div className="span-2"><Callout tone="bad">{error}</Callout></div>}
      </form>
    </Modal>
  );
}

export default function Projects() {
  const [status, setStatus] = useState("active");
  const [list, setList] = useState(null);
  const [creating, setCreating] = useState(false);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();

  useEffect(() => {
    setList(null);
    api.get("/projects", { params: { status } }).then(({ data }) => setList(data)).catch(async (err) => toast.bad(await errorMessage(err)));
  }, [status]);

  return (
    <div className="col gap-16">
      <div className="row between wrap">
        <Segmented label="Show" value={status} onChange={setStatus} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        {isLead(user) && <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>New project</Button>}
      </div>
      {!list ? (
        <div className="project-grid">{[0, 1, 2].map((i) => <Skeleton key={i} h={150} />)}</div>
      ) : list.length === 0 ? (
        <div className="panel">
          <Empty
            icon={<FolderKanban />}
            title={status === "archived" ? "No archived projects" : "No projects yet"}
            action={isLead(user) && status === "active" ? <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>Create a project</Button> : null}
          >
            {isLead(user)
              ? "A project groups people and tasks: a campaign, a product, a client. Its tasks get keys like MKT-12."
              : "When you're added to a project, it shows up here with its board and calendar."}
          </Empty>
        </div>
      ) : (
        <div className="project-grid">
          {list.map((p) => {
            const pct = p.task_count ? Math.round((p.done_count / p.task_count) * 100) : 0;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="panel project-card" style={{ "--pc": p.color }}>
                <div className="row between">
                  <TaskKey k={p.key} color={p.color} />
                  <span className="kind-tag">{KINDS[p.kind]}</span>
                </div>
                <div className="col gap-4">
                  <span className="h2">{p.name}</span>
                  {p.goal && <span className="small muted">{p.goal}</span>}
                </div>
                <div className="col gap-4">
                  <div className="meter"><i style={{ width: `${pct}%`, background: "var(--seal)" }} /></div>
                  <div className="row between small muted">
                    <span>{p.done_count} of {p.task_count} done</span>
                    <span>
                      {p.review_count > 0 && <span style={{ color: "var(--signal)" }}>{p.review_count} in review </span>}
                      {p.overdue_count > 0 && <b style={{ color: "var(--breach)" }}>{p.overdue_count} late</b>}
                    </span>
                  </div>
                </div>
                <div className="row between small muted">
                  <span>{p.member_count} {p.member_count === 1 ? "person" : "people"}{p.team_name ? ` · ${p.team_name}` : ""}</span>
                  {p.end_date && <span>Ends {shortDate(p.end_date)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); toast.ok(`${p.key} created`); navigate(`/projects/${p.id}`); }} />}
    </div>
  );
}
