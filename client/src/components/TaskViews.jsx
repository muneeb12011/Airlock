import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, Plus, FileDown, ListChecks, LayoutGrid, Rows3, CalendarDays, Ban } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useLive from "../store/live";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { download, errorMessage } from "../lib/download";
import { STATUS, TYPES, PRIORITIES, isoDate, isLead } from "../lib/format";
import { Avatar, Button, Callout, Due, Empty, Labels, Priority, Segmented, Skeleton, StatusPill, TaskKey } from "./ui";
import TaskCard, { ChecklistMeter } from "./TaskCard";
import TaskDrawer from "./TaskDrawer";
import TaskForm from "./TaskForm";

const LANES = ["pending", "in_progress", "in_review", "completed"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- calendar (marketing content calendar, release dates) ----------
export function CalendarView({ tasks, onOpen, month, setMonth, onCreate }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday first
  const start = new Date(first);
  start.setDate(first.getDate() - startOffset);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const byDay = useMemo(() => {
    const m = {};
    for (const t of tasks) if (t.due_date) (m[t.due_date] ||= []).push(t);
    return m;
  }, [tasks]);
  const today = isoDate(new Date());
  const [expanded, setExpanded] = useState(null);
  const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const undated = tasks.filter((t) => !t.due_date && t.status !== "completed").length;
  const monthTasks = days
    .filter((d) => d.getMonth() === month.getMonth())
    .flatMap((d) => (byDay[isoDate(d)] || []).map((t) => ({ d, t })));

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          <Button size="sm" variant="ghost" icon={<ChevronLeft />} aria-label="Previous month" onClick={() => shift(-1)} />
          <h2 className="h2" style={{ minWidth: 150, textAlign: "center" }}>{label}</h2>
          <Button size="sm" variant="ghost" icon={<ChevronRight />} aria-label="Next month" onClick={() => shift(1)} />
          <Button size="sm" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</Button>
        </div>
        {undated > 0 && <span className="small muted">{undated} open task{undated === 1 ? " has" : "s have"} no date</span>}
      </div>
      <div className="cal" role="grid" aria-label={label}>
        {DOW.map((d) => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
        {days.map((d) => {
          const key = isoDate(d);
          const list = byDay[key] || [];
          const show = expanded === key ? list : list.slice(0, 3);
          return (
            <div
              key={key}
              role="gridcell"
              className={`cal-day ${d.getMonth() !== month.getMonth() ? "out" : ""} ${key === today ? "today" : ""}`}
              onDoubleClick={() => onCreate?.(key)}
            >
              <span className="cal-num">{d.getDate()}</span>
              {show.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`cal-item ${t.status === "completed" ? "done" : t.is_overdue ? "late" : ""}`}
                  style={{ "--pc": t.project_color || "var(--faint)" }}
                  title={`${t.key ? `${t.key} ` : ""}${t.title} — ${t.assignee_name || ""}${t.channel ? ` · ${t.channel}` : ""}`}
                  onClick={() => onOpen(t.id)}
                >
                  {t.channel ? `${t.channel}: ` : ""}{t.title}
                </button>
              ))}
              {list.length > 3 && expanded !== key && (
                <button type="button" className="cal-more" onClick={() => setExpanded(key)}>+{list.length - 3} more</button>
              )}
            </div>
          );
        })}
      </div>
      <div className="cal-agenda panel-list">
        {monthTasks.length === 0 && <div className="empty small">Nothing due this month.</div>}
        {monthTasks.map(({ d, t }) => (
          <button key={t.id} type="button" className="task-row" style={{ gridTemplateColumns: "56px minmax(0,1fr)", border: 0, background: "transparent", width: "100%", textAlign: "left" }} onClick={() => onOpen(t.id)}>
            <span className="small muted">{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
            <span className="col gap-4" style={{ minWidth: 0 }}>
              <span className="title ellipsis">{t.title}</span>
              <span className="row gap-8"><TaskKey task={t} />{t.channel && <span className="tag">{t.channel}</span>}<StatusPill status={t.status} /></span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- list with bulk actions ----------
function BulkBar({ ids, onDone, projects, people }) {
  const [action, setAction] = useState("priority");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (action === "delete" && !window.confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post("/tasks/bulk", { ids, action, value: value || null });
      toast.ok(`Updated ${data.updated} task${data.updated === 1 ? "" : "s"}${data.skipped ? ` · skipped ${data.skipped} you don't manage` : ""}`);
      onDone();
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const valueInput = {
    priority: (
      <select className="select input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Priority">
        <option value="">Choose…</option>
        {Object.entries(PRIORITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    ),
    assign: (
      <select className="select input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Assignee">
        <option value="">Choose…</option>
        {(people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    ),
    due_date: <input className="input" type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Due date" />,
    add_label: <input className="input" placeholder="label" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Label" />,
    remove_label: <input className="input" placeholder="label" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Label" />,
    move_project: (
      <select className="select input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Project">
        <option value="">No project</option>
        {(projects || []).filter((p) => p.status === "active").map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
      </select>
    ),
  }[action];
  const needsValue = ["priority", "assign", "add_label", "remove_label"].includes(action);
  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions">
      <b>{ids.length} selected</b>
      <select className="select input" value={action} onChange={(e) => { setAction(e.target.value); setValue(""); }} aria-label="Action">
        <option value="priority">Set priority</option>
        <option value="assign">Reassign</option>
        <option value="due_date">Set due date</option>
        <option value="add_label">Add label</option>
        <option value="remove_label">Remove label</option>
        <option value="move_project">Move to project</option>
        <option value="close">Mark done</option>
        <option value="delete">Delete</option>
      </select>
      {valueInput}
      <Button size="sm" variant={action === "delete" ? "danger solid" : "primary"} loading={busy} disabled={needsValue && !value} onClick={run}>Apply</Button>
    </div>
  );
}

export function ListView({ tasks, onOpen, selectable, selected, setSelected }) {
  const all = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  return (
    <div className="panel panel-list" role="list">
      {selectable && (
        <div className="row small muted" style={{ padding: "8px 18px" }}>
          <input type="checkbox" className="sel" checked={all} onChange={() => setSelected(all ? new Set() : new Set(tasks.map((t) => t.id)))} aria-label="Select all" />
          <span>{selected.size ? `${selected.size} selected` : "Select tasks to change several at once"}</span>
        </div>
      )}
      {tasks.map((t) => (
        <div
          key={t.id}
          role="listitem"
          className="task-row"
          tabIndex={0}
          style={selectable ? { gridTemplateColumns: "20px minmax(0, 1fr) 170px 100px 112px" } : undefined}
          onClick={() => onOpen(t.id)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(t.id)}
        >
          {selectable && (
            <input type="checkbox" className="sel" checked={selected.has(t.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(t.id)} aria-label={`Select ${t.title}`} />
          )}
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <span className="row gap-8" style={{ minWidth: 0 }}>
              <TaskKey task={t} />
              <span className="title ellipsis">{t.title}</span>
              {t.is_blocked && t.status !== "completed" && <Ban size={13} color="var(--breach)" aria-label="Blocked" />}
            </span>
            <span className="row gap-12 wrap">
              <span className="tag">{t.channel || TYPES[t.type]}</span>
              <Due date={t.due_date} status={t.status} />
              <ChecklistMeter task={t} />
              <Labels labels={t.labels} max={3} />
            </span>
          </div>
          <span className="row gap-8 hide-sm" style={{ minWidth: 0 }}>
            <Avatar name={t.assignee_name || "?"} id={t.assigned_to} src={t.assignee_avatar_url} size="sm" showPresence />
            <span className="ellipsis small">{t.assignee_name || "Unassigned"}</span>
          </span>
          <span className="hide-sm"><Priority value={t.priority} /></span>
          <span style={{ justifySelf: "end" }}><StatusPill status={t.status} /></span>
        </div>
      ))}
    </div>
  );
}

export function BoardView({ tasks, onOpen }) {
  return (
    <div className="board">
      {LANES.map((s) => {
        const list = tasks.filter((t) => t.status === s);
        return (
          <section key={s} className="lane" aria-label={STATUS[s]}>
            <div className="lane-head"><span className="h3">{STATUS[s]}</span><span className="tag">{list.length}</span></div>
            {list.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} showAssignee />)}
          </section>
        );
      })}
    </div>
  );
}

// ---------- the full task workspace: filters + list/board/calendar ----------
export default function TaskWorkspace({ projectId = null, project = null, defaultView = "list", title }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [params, setParams] = useSearchParams();
  const version = useLive((s) => s.taskVersion);
  const user = useAuth((s) => s.user);
  const { people, projects, loadPeople, loadProjects } = useWorkspace();
  const lead = isLead(user);
  const viewKey = projectId ? `airlock-view-p${projectId}` : "airlock-task-view";
  const [view, setViewState] = useState(() => {
    try { return params.get("view") || localStorage.getItem(viewKey) || defaultView; } catch { return defaultView; }
  });
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const status = params.get("status") || (view === "list" ? "open" : "all");
  const assignee = params.get("assignee") || "";
  const priority = params.get("priority") || "";
  const label = params.get("label") || "";
  const proj = projectId ? String(projectId) : params.get("project") || "";
  const q = params.get("q") || "";
  const openId = params.get("task");

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: k === "q" });
  };
  const setView = (v) => {
    setViewState(v);
    try { localStorage.setItem(viewKey, v); } catch { /* ignore */ }
  };

  useEffect(() => {
    const query = { limit: 1000 };
    if (proj) query.project = proj;
    api.get("/tasks", { params: query }).then(({ data }) => setTasks(data)).catch(async (err) => setError(await errorMessage(err, "Couldn't load tasks.")));
  }, [version, proj]);
  useEffect(() => {
    loadPeople().catch(() => {});
    loadProjects().catch(() => {});
  }, [loadPeople, loadProjects]);

  const base = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (tasks || []).filter(
      (t) =>
        (!assignee || (assignee === "me" ? t.assigned_to === user.id : String(t.assigned_to) === assignee)) &&
        (!priority || t.priority === priority) &&
        (!label || t.labels?.includes(label)) &&
        (!term || t.title.toLowerCase().includes(term) || (t.key || "").toLowerCase() === term || (t.assignee_name || "").toLowerCase().includes(term))
    );
  }, [tasks, assignee, priority, label, q, user.id]);
  const match = (t, s) => (s === "open" ? t.status !== "completed" : s === "overdue" ? t.is_overdue : s === "blocked" ? t.is_blocked && t.status !== "completed" : s === "all" ? true : t.status === s);
  const count = (s) => base.filter((t) => match(t, s)).length;
  const shown = base.filter((t) => match(t, status));
  const allLabels = useMemo(() => [...new Set((tasks || []).flatMap((t) => t.labels || []))].sort(), [tasks]);

  const open = (id) => setParam("task", String(id));
  const exportCsv = async () => {
    setExporting(true);
    try {
      await download("/admin/tasks.csv", "tasks.csv");
    } catch (err) {
      toast.bad(await errorMessage(err, "Export blocked."));
    } finally {
      setExporting(false);
    }
  };
  const canCreate = lead && (!project || project.can_manage) && project?.status !== "archived";

  return (
    <div className="col gap-16">
      <div className="row wrap between gap-12">
        <div className="segmented" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><Rows3 size={15} /> List</button>
          <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}><LayoutGrid size={15} /> Board</button>
          <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}><CalendarDays size={15} /> Calendar</button>
        </div>
        <div className="row">
          {lead && <Button icon={<FileDown />} loading={exporting} onClick={exportCsv} className="hide-sm">CSV</Button>}
          {canCreate && <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})}>New task</Button>}
        </div>
      </div>

      <div className="row wrap gap-12">
        <div className="search grow" style={{ minWidth: 200, maxWidth: 320 }}>
          <Search />
          <input className="input" placeholder="Search, or a key like WEB-12" value={q} onChange={(e) => setParam("q", e.target.value)} aria-label="Search tasks" />
        </div>
        {!projectId && (
          <select className="select input" style={{ width: "auto" }} value={proj} onChange={(e) => setParam("project", e.target.value)} aria-label="Filter by project">
            <option value="">All projects</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
        )}
        <select className="select input" style={{ width: "auto" }} value={assignee} onChange={(e) => setParam("assignee", e.target.value)} aria-label="Filter by person">
          <option value="">Everyone</option>
          <option value="me">Assigned to me</option>
          {(people || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="select input" style={{ width: "auto" }} value={priority} onChange={(e) => setParam("priority", e.target.value)} aria-label="Filter by priority">
          <option value="">Any priority</option>
          {Object.entries(PRIORITIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {allLabels.length > 0 && (
          <select className="select input" style={{ width: "auto" }} value={label} onChange={(e) => setParam("label", e.target.value)} aria-label="Filter by label">
            <option value="">Any label</option>
            {allLabels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
      </div>

      {view === "list" && (
        <Segmented
          label="Filter by status"
          value={status}
          onChange={(v) => setParam("status", v === "open" ? "" : v)}
          options={[
            { value: "open", label: "Open", count: count("open") },
            { value: "in_review", label: "Needs review", count: count("in_review") },
            { value: "overdue", label: "Overdue", count: count("overdue") },
            { value: "blocked", label: "Blocked", count: count("blocked") },
            { value: "completed", label: "Done", count: count("completed") },
            { value: "all", label: "All", count: count("all") },
          ]}
        />
      )}

      {error && <Callout tone="bad">{error}</Callout>}

      {!tasks ? (
        <div className="panel panel-body col gap-12"><Skeleton h={22} /><Skeleton h={22} /><Skeleton h={22} /></div>
      ) : view === "calendar" ? (
        <CalendarView tasks={base} onOpen={open} month={month} setMonth={setMonth} onCreate={canCreate ? (d) => setCreating({ due_date: d }) : undefined} />
      ) : view === "board" ? (
        <BoardView tasks={base} onOpen={open} />
      ) : shown.length === 0 ? (
        <div className="panel">
          <Empty
            icon={<ListChecks />}
            title={tasks.length ? "Nothing matches these filters" : title || "No tasks yet"}
            action={!tasks.length && canCreate ? <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})}>Create the first task</Button> : null}
          >
            {tasks.length ? "Try a different status or clear the search." : lead ? "Tasks show up here with status, due dates and review state." : "Work assigned to you or your projects appears here."}
          </Empty>
        </div>
      ) : (
        <ListView tasks={shown} onOpen={open} selectable={lead} selected={selected} setSelected={setSelected} />
      )}

      {lead && selected.size > 0 && view === "list" && (
        <BulkBar ids={[...selected]} projects={projects} people={people} onDone={() => { setSelected(new Set()); useLive.getState().bumpTasks(); }} />
      )}

      {openId && <TaskDrawer taskId={openId} onClose={() => setParam("task", "")} onOpenTask={open} />}
      {creating && (
        <TaskForm
          defaults={{ project_id: projectId, ...creating }}
          onClose={() => setCreating(null)}
          onSaved={(t) => {
            setCreating(null);
            toast.ok(`${t.key || "Task"} created for ${t.assignee_name}`);
            setTasks((list) => [t, ...(list || [])]);
            useWorkspace.getState().loadLabels(true).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
