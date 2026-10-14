import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, ShieldAlert, KeyRound, Lock, FileWarning, MapPin, Link2, Hourglass, CircleCheck } from "lucide-react";
import api from "../../api";
import useLive from "../../store/live";
import useAuth from "../../store/auth";
import { toast } from "../../store/toast";
import { errorMessage } from "../../lib/download";
import { describe, isAlarming } from "../../lib/activity";
import { timeAgo } from "../../lib/format";
import { Avatar, Button, Callout, Due, Empty, Priority, Skeleton, TaskKey } from "../../components/ui";

function PostureRow({ tone, icon: Icon, children, to }) {
  const body = (
    <div className={`posture-row ${tone}`}>
      <Icon aria-hidden />
      <div className="grow small">{children}</div>
    </div>
  );
  return to ? <Link to={to} style={{ color: "inherit", textDecoration: "none" }}>{body}</Link> : body;
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [review, setReview] = useState([]);
  const [error, setError] = useState("");
  const [chain, setChain] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const version = useLive((s) => s.taskVersion);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/reports/overview").then(({ data }) => setData(data)).catch(async (err) => setError(await errorMessage(err, "Couldn't load the overview.")));
    api.get("/tasks", { params: { status: "in_review" } }).then(({ data }) => setReview(data)).catch(() => {});
  }, [version]);

  const verify = async () => {
    setVerifying(true);
    try {
      const { data } = await api.post("/admin/audit/verify");
      setChain(data);
      data.ok ? toast.ok(`Audit log intact — ${data.checked} entries verified`) : toast.bad(`Audit log tampering detected at entry #${data.brokenAt}`);
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  if (error) return <Callout tone="bad">{error}</Callout>;
  if (!data) return <div className="col gap-16"><Skeleton h={20} w={420} /><Skeleton h={260} /></div>;

  const { tasks, security: s, workload, due_soon, recent } = data;
  const coverage = s?.active_users ? Math.round((s.users_with_2fa / s.active_users) * 100) : 0;
  const { projects = [] } = data;
  const maxLoad = Math.max(1, ...workload.map((w) => w.open + w.in_review));

  return (
    <div className="col gap-16">
      <div className="status-strip" aria-label="Task summary">
        <span><b>{tasks.pending + tasks.in_progress}</b>open</span>
        <span><b>{tasks.in_review}</b>waiting for your review</span>
        <span className={tasks.overdue ? "alert" : ""}><b>{tasks.overdue}</b>overdue</span>
        <span><b>{tasks.completed_7d}</b>done this week</span>
      </div>

      {!user.totp_enabled && (
        <Callout tone="warn" title="Your account doesn't have two-step sign-in">
          Accounts that can assign and approve work are the first thing attackers go after. <Link to="/profile?tab=security">Turn it on</Link> — it takes a minute.
        </Callout>
      )}

      <div className="ov-grid">
        <div className="col gap-16">
          <section className="panel">
            <div className="panel-head">
              <h2 className="h2 row"><Hourglass size={16} color="var(--signal)" /> Needs your review</h2>
              {review.length > 0 && <Link className="small" to="/tasks?status=in_review">See all</Link>}
            </div>
            {review.length === 0 ? (
              <Empty icon={<CircleCheck />} title="Review queue is empty">Submitted work lands here for you to approve or send back.</Empty>
            ) : (
              <div className="panel-list">
                {review.slice(0, 6).map((t) => (
                  <button key={t.id} type="button" className="task-row" style={{ border: 0, background: "transparent", width: "100%", textAlign: "left", gridTemplateColumns: "minmax(0,1fr) auto" }} onClick={() => navigate(`/tasks?task=${t.id}`)}>
                    <span className="row gap-12" style={{ minWidth: 0 }}>
                      <Avatar name={t.assignee_name || "?"} id={t.assigned_to} size="sm" />
                      <span className="col gap-4" style={{ minWidth: 0 }}>
                        <span className="row gap-8" style={{ minWidth: 0 }}><TaskKey task={t} /><span className="title ellipsis">{t.title}</span></span>
                        <span className="small muted">{t.assignee_name} submitted {timeAgo(t.updated_at)}</span>
                      </span>
                    </span>
                    <Priority value={t.priority} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="h2">Team workload</h2><Link className="small" to="/people">People</Link></div>
            {workload.length === 0 ? (
              <Empty title="No team members yet" action={<Button variant="primary" onClick={() => navigate("/people?tab=accounts")}>Add your first member</Button>}>
                Airlock has no public sign-up. You create each account and hand over a one-time password.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Person</th><th style={{ width: "34%" }}>Load</th><th className="num">Open</th><th className="num">Review</th><th className="num">Overdue</th><th className="num">Done (30d)</th></tr></thead>
                  <tbody>
                    {workload.map((w) => (
                      <tr key={w.id} className="clickable" onClick={() => navigate(`/tasks?assignee=${w.id}`)}>
                        <td className="nowrap"><span className="row"><Avatar name={w.name} id={w.id} src={w.avatar_url} size="sm" showPresence /> {w.name}</span></td>
                        <td>
                          <div className="meter" title={`${w.open} open, ${w.in_review} in review`}>
                            <i style={{ width: `${(w.open / maxLoad) * 100}%`, background: "var(--info)" }} />
                            <i style={{ width: `${(w.in_review / maxLoad) * 100}%`, background: "var(--signal)" }} />
                          </div>
                        </td>
                        <td className="num">{w.open}</td>
                        <td className="num">{w.in_review}</td>
                        <td className="num" style={{ color: w.overdue ? "var(--breach)" : undefined, fontWeight: w.overdue ? 700 : undefined }}>{w.overdue}</td>
                        <td className="num">{w.done_30d}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {due_soon.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2 className="h2">Due soon or overdue</h2></div>
              <div className="panel-list">
                {due_soon.map((t) => (
                  <Link key={t.id} to={`/admin/tasks?task=${t.id}`} className="row between" style={{ padding: "11px 18px", color: "inherit", textDecoration: "none" }}>
                    <span className="col gap-4" style={{ minWidth: 0 }}>
                      <span className="ellipsis" style={{ fontWeight: 600 }}>{t.title}</span>
                      <span className="small muted">{t.assignee_name}</span>
                    </span>
                    <Due date={t.due_date} status={t.status} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="col gap-16">
          {s && (
          <section className="panel posture">
            <div className="panel-head"><h2 className="h2 row"><ShieldCheck size={16} color="var(--seal)" /> Security posture</h2><Link className="small" to="/admin/security">Details</Link></div>
            <div className="panel-list">
              <PostureRow tone={coverage === 100 ? "ok" : coverage >= 50 ? "warn" : "bad"} icon={KeyRound} to="/people?tab=accounts">
                <b>{s.users_with_2fa} of {s.active_users}</b> accounts use two-step sign-in
                <div className="meter mt-4"><i style={{ width: `${coverage}%`, background: coverage === 100 ? "var(--seal)" : "var(--signal)" }} /></div>
              </PostureRow>
              <PostureRow tone={s.failed_logins_24h > 10 ? "bad" : s.failed_logins_24h ? "warn" : "ok"} icon={ShieldAlert} to="/admin/security?tab=signins">
                <b>{s.failed_logins_24h}</b> failed sign-in{s.failed_logins_24h === 1 ? "" : "s"} in the last 24 hours
              </PostureRow>
              <PostureRow tone={s.locked_accounts ? "bad" : "ok"} icon={Lock} to="/people?tab=accounts">
                <b>{s.locked_accounts}</b> account{s.locked_accounts === 1 ? "" : "s"} locked right now
              </PostureRow>
              <PostureRow tone={s.blocked_uploads_7d ? "warn" : "ok"} icon={FileWarning} to="/admin/security?tab=files">
                <b>{s.blocked_uploads_7d}</b> dangerous file{s.blocked_uploads_7d === 1 ? "" : "s"} stopped by File Shield this week
              </PostureRow>
              <PostureRow tone={s.new_ip_logins_7d ? "warn" : "ok"} icon={MapPin} to="/admin/security?tab=signins">
                <b>{s.new_ip_logins_7d}</b> sign-in{s.new_ip_logins_7d === 1 ? "" : "s"} from unfamiliar networks this week
              </PostureRow>
              <div className={`posture-row ${chain ? (chain.ok ? "ok" : "bad") : ""}`}>
                <Link2 aria-hidden />
                <div className="grow small">
                  {chain ? (chain.ok ? <><b>Audit log intact</b> — {chain.checked} entries verified</> : <><b>Tampering found</b> at entry #{chain.brokenAt}</>) : "Audit log integrity not checked yet"}
                </div>
                <Button size="sm" loading={verifying} onClick={verify}>Verify</Button>
              </div>
            </div>
          </section>
          )}

          {projects.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h2 className="h2">Projects</h2><Link className="small" to="/projects">All projects</Link></div>
              <div className="panel-list">
                {projects.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="col gap-4" style={{ padding: "11px 18px", color: "inherit", textDecoration: "none" }}>
                    <span className="row between">
                      <span className="row gap-8" style={{ minWidth: 0 }}><TaskKey k={p.key} color={p.color} /><b className="ellipsis">{p.name}</b></span>
                      <span className="small muted nowrap">{p.done}/{p.total}{p.overdue ? <b style={{ color: "var(--breach)" }}> · {p.overdue} late</b> : ""}</span>
                    </span>
                    <span className="meter"><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%`, background: "var(--seal)" }} /></span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2 className="h2">Recent activity</h2>{s && <Link className="small" to="/admin/security?tab=audit">Full log</Link>}</div>
            <div className="panel-list">
              {recent.length === 0 && <div className="empty small">Nothing yet.</div>}
              {recent.map((e) => (
                <div key={e.id} className="feed-item">
                  <span style={{ color: isAlarming(e) ? "var(--breach)" : undefined }}>{describe(e)}</span>
                  <time dateTime={e.created_at}>{timeAgo(e.created_at)}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
