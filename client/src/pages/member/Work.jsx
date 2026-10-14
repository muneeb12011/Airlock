import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, Inbox } from "lucide-react";
import api from "../../api";
import useLive from "../../store/live";
import useAuth from "../../store/auth";
import useWorkspace from "../../store/workspace";
import { errorMessage } from "../../lib/download";
import { STATUS } from "../../lib/format";
import TaskCard from "../../components/TaskCard";
import TaskDrawer from "../../components/TaskDrawer";
import { Callout, Empty, Segmented, Skeleton, TaskKey } from "../../components/ui";

const LANES = ["pending", "in_progress", "in_review", "completed"];
const LANE_EMPTY = {
  pending: "Nothing new assigned.",
  in_progress: "Start a task to move it here.",
  in_review: "Submitted work waits here for approval.",
  completed: "Approved work shows up here.",
};

// A member's home: their own tasks as a board, plus the projects they're on.
export default function Work() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [lane, setLane] = useState("in_progress");
  const [params, setParams] = useSearchParams();
  const version = useLive((s) => s.taskVersion);
  const user = useAuth((s) => s.user);
  const { projects, loadProjects } = useWorkspace();
  const openId = params.get("task");

  useEffect(() => {
    api.get("/tasks", { params: { assignee: "me" } }).then(({ data }) => setTasks(data)).catch(async (err) => setError(await errorMessage(err, "Couldn't load your tasks.")));
  }, [version]);
  useEffect(() => { loadProjects(true).catch(() => {}); }, [loadProjects, version]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (tasks || []).filter((t) => !term || t.title.toLowerCase().includes(term) || (t.key || "").toLowerCase() === term || (t.description || "").toLowerCase().includes(term));
  }, [tasks, q]);
  const by = (s) => filtered.filter((t) => t.status === s);

  const open = (id) => setParams({ task: String(id) });
  const close = () => setParams({});
  const overdue = (tasks || []).filter((t) => t.is_overdue).length;
  const active = (tasks || []).filter((t) => t.status === "pending" || t.status === "in_progress").length;
  const myProjects = (projects || []).filter((p) => p.status === "active");

  return (
    <div className="col gap-16">
      {tasks && (
        <p className="muted" style={{ margin: 0 }}>
          {active === 0 ? `You're clear, ${user.name.split(" ")[0]}. Nothing waiting on you.` : `${active} task${active === 1 ? "" : "s"} waiting on you`}
          {overdue > 0 && <b style={{ color: "var(--breach)" }}>, {overdue} overdue</b>}
        </p>
      )}
      {myProjects.length > 0 && (
        <div className="row wrap gap-8" aria-label="Your projects">
          {myProjects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="pill" style={{ textDecoration: "none", height: 28, gap: 8 }}>
              <TaskKey k={p.key} color={p.color} /> {p.name}
            </Link>
          ))}
        </div>
      )}
      <div className="row wrap between">
        <div className="search" style={{ width: "min(320px, 100%)" }}>
          <Search />
          <input className="input" placeholder="Search your tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your tasks" />
        </div>
        <div className="mobile-only">
          <Segmented label="Show" value={lane} onChange={setLane} options={LANES.map((s) => ({ value: s, label: STATUS[s], count: by(s).length }))} />
        </div>
      </div>
      {error && <Callout tone="bad">{error}</Callout>}

      {!tasks ? (
        <div className="board">{LANES.map((l) => <div key={l} className="lane"><Skeleton h={80} /></div>)}</div>
      ) : tasks.length === 0 ? (
        <div className="panel"><Empty icon={<Inbox />} title="No tasks yet">When work is assigned to you, it appears here and you'll get a notification.</Empty></div>
      ) : (
        <div className="board">
          {LANES.map((s) => (
            <section key={s} className="lane board-lane" data-active={lane === s} aria-label={STATUS[s]}>
              <div className="lane-head">
                <span className="h3">{STATUS[s]}</span>
                <span className="tag">{by(s).length}</span>
              </div>
              {by(s).map((t) => <TaskCard key={t.id} task={t} onOpen={open} />)}
              {by(s).length === 0 && <p className="small faint" style={{ margin: "4px 6px" }}>{LANE_EMPTY[s]}</p>}
            </section>
          ))}
        </div>
      )}

      {openId && <TaskDrawer taskId={openId} onClose={close} onOpenTask={open} />}
    </div>
  );
}
