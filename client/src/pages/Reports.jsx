import { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import useWorkspace from "../store/workspace";
import { errorMessage } from "../lib/download";
import { TYPES, shortDate } from "../lib/format";
import { Callout, Segmented, Skeleton } from "../components/ui";

const niceMax = (v) => {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow / (v / pow > 5 ? 2 : 1)) * pow * (v / pow > 5 ? 2 : 1);
};

function useTip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = e.currentTarget.closest(".chart-wrap").getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, content });
  };
  return [tip, show, () => setTip(null)];
}

// Created vs completed per week: grouped columns, one axis.
function ThroughputChart({ weekly }) {
  const W = 640;
  const H = 220;
  const pad = { l: 32, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...weekly.flatMap((w) => [w.created, w.completed])));
  const band = (W - pad.l - pad.r) / weekly.length;
  const bw = Math.min(14, (band - 10) / 2);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const [tip, show, hide] = useTip();
  const bar = (x, v, color, label, w) => {
    const top = y(v);
    const h = Math.max(0, H - pad.b - top);
    const r = Math.min(4, h / 2, bw / 2);
    const d = h === 0 ? "" : `M${x},${H - pad.b} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - pad.b} Z`;
    return (
      <g key={label} tabIndex={0} onMouseEnter={(e) => show(e, w)} onFocus={(e) => show(e, w)} onMouseLeave={hide} onBlur={hide} aria-label={`${label}: ${v}`}>
        <rect x={x - 2} y={pad.t} width={bw + 4} height={H - pad.t - pad.b} fill="transparent" />
        <path d={d} fill={color} />
      </g>
    );
  };
  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tasks created and completed per week">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
          </g>
        ))}
        {weekly.map((w, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={w.week}>
              {bar(cx - bw - 1, w.created, "var(--chart-1)", `Week of ${shortDate(w.week)} created`, w)}
              {bar(cx + 1, w.completed, "var(--chart-2)", `Week of ${shortDate(w.week)} completed`, w)}
              <text x={cx} y={H - 8} textAnchor="middle">{shortDate(w.week)}</text>
            </g>
          );
        })}
      </svg>
      {tip && (
        <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="small" style={{ opacity: 0.75 }}>Week of {shortDate(tip.content.week)}</div>
          <div><b>{tip.content.created}</b> created</div>
          <div><b>{tip.content.completed}</b> completed</div>
        </div>
      )}
    </div>
  );
}

// Average days from created to done, per week. Single series line.
function CycleChart({ weekly }) {
  const W = 640;
  const H = 180;
  const pad = { l: 32, r: 30, t: 14, b: 26 };
  const pts = weekly.map((w, i) => ({ ...w, i })).filter((w) => w.cycle_days != null);
  const max = niceMax(Math.max(1, ...pts.map((p) => p.cycle_days)));
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, weekly.length - 1);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  const onMove = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (weekly.length - 1));
    setHover(Math.max(0, Math.min(weekly.length - 1, i)));
  };
  const path = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.cycle_days)}`).join(" ");
  const last = pts[pts.length - 1];
  const h = hover != null ? weekly[hover] : null;
  if (!pts.length) return <p className="small muted" style={{ margin: 0 }}>No tasks were completed in this period.</p>;
  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      <svg ref={svgRef} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average cycle time in days per week" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{Math.round(t * 10) / 10}</text>
          </g>
        ))}
        {weekly.map((w, i) => <text key={w.week} x={x(i)} y={H - 8} textAnchor="middle">{shortDate(w.week)}</text>)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" />}
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => <circle key={p.week} cx={x(p.i)} cy={y(p.cycle_days)} r={hover === p.i ? 5 : 4} fill="var(--chart-1)" stroke="var(--panel)" strokeWidth="2" />)}
        {last && <text x={x(last.i) + 8} y={y(last.cycle_days) + 4} style={{ fill: "var(--ink)", fontWeight: 600 }}>{last.cycle_days}d</text>}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: 0 }}>
          <div className="small" style={{ opacity: 0.75 }}>Week of {shortDate(h.week)}</div>
          <div>{h.cycle_days != null ? <><b>{h.cycle_days} days</b> average</> : "Nothing completed"}</div>
        </div>
      )}
    </div>
  );
}

function HBars({ rows, labelKey, valueKey, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  return (
    <div className="col gap-8">
      {rows.map((r) => (
        <div key={r[labelKey]} className="row gap-12" title={`${format(r[labelKey])}: ${r[valueKey]}`}>
          <span className="small ellipsis" style={{ width: 120, flex: "none" }}>{format(r[labelKey])}</span>
          <span className="grow" style={{ height: 14, display: "flex" }}>
            <i style={{ width: `${(r[valueKey] / max) * 100}%`, minWidth: 2, background: "var(--chart-1)", borderRadius: "0 4px 4px 0" }} />
          </span>
          <span className="small" style={{ width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r[valueKey]}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const [project, setProject] = useState("");
  const [weeks, setWeeks] = useState("8");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { projects, loadProjects } = useWorkspace();
  useEffect(() => { loadProjects().catch(() => {}); }, [loadProjects]);

  useEffect(() => {
    setLoading(true);
    api.get("/reports/delivery", { params: { weeks, project: project || undefined } })
      .then(({ data }) => { setData(data); setError(""); })
      .catch(async (err) => setError(await errorMessage(err, "Couldn't load the report.")))
      .finally(() => setLoading(false));
  }, [project, weeks]);

  const s = data?.summary;
  const onTime = s?.with_due ? Math.round((s.on_time / s.with_due) * 100) : null;
  const typeRows = useMemo(() => (data?.types || []).map((t) => ({ ...t, label: TYPES[t.type] || t.type })), [data]);

  return (
    <div className="col gap-16">
      <div className="row wrap gap-12">
        <select className="select input" style={{ width: "auto" }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">All projects you manage</option>
          {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
        </select>
        <Segmented label="Period" value={weeks} onChange={setWeeks} options={[{ value: "4", label: "4 weeks" }, { value: "8", label: "8 weeks" }, { value: "12", label: "12 weeks" }, { value: "26", label: "6 months" }]} />
      </div>
      {error && <Callout tone="bad">{error}</Callout>}
      {!data ? <Skeleton h={300} /> : (
        <div className="col gap-16" style={{ opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
          <div className="panel stat-line">
            <div><b>{s.completed}</b><span>completed in {data.weeks} weeks</span></div>
            <div><b>{onTime == null ? "—" : `${onTime}%`}</b><span>finished on time (of {s.with_due} with a due date)</span></div>
            <div><b>{s.avg_cycle_days == null ? "—" : `${s.avg_cycle_days}d`}</b><span>average from created to done</span></div>
            <div><b>{s.avg_review_rounds == null ? "—" : s.avg_review_rounds}</b><span>submissions per task (1 = approved first time)</span></div>
            <div><b>{s.open}</b><span>open now{s.overdue ? `, ${s.overdue} overdue` : ""}</span></div>
          </div>

          <div className="ov-grid">
            <section className="panel">
              <div className="panel-head">
                <h2 className="h2">Throughput</h2>
                <div className="legend"><span><i style={{ background: "var(--chart-1)" }} />Created</span><span><i style={{ background: "var(--chart-2)" }} />Completed</span></div>
              </div>
              <div className="panel-body"><ThroughputChart weekly={data.weekly} /></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="h2">Work by type</h2></div>
              <div className="panel-body">{typeRows.length ? <HBars rows={typeRows} labelKey="label" valueKey="n" /> : <span className="small muted">No tasks created in this period.</span>}</div>
            </section>
          </div>

          <div className="ov-grid">
            <section className="panel">
              <div className="panel-head"><h2 className="h2">Cycle time (days, created → done)</h2></div>
              <div className="panel-body"><CycleChart weekly={data.weekly} /></div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="h2">Top labels</h2></div>
              <div className="panel-body">{data.labels.length ? <HBars rows={data.labels} labelKey="label" valueKey="n" /> : <span className="small muted">Label tasks (e.g. bug, launch, seo) to see where effort goes.</span>}</div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head"><h2 className="h2">By person</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Person</th><th className="num">Completed</th><th className="num">On time</th><th className="num">Points</th><th className="num">Overdue now</th></tr></thead>
                <tbody>
                  {data.people.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="num">{p.completed}</td>
                      <td className="num">{p.completed ? `${Math.round((p.on_time / p.completed) * 100)}%` : "—"}</td>
                      <td className="num">{p.points}</td>
                      <td className="num" style={{ color: p.overdue ? "var(--breach)" : undefined }}>{p.overdue}</td>
                    </tr>
                  ))}
                  {!data.people.length && <tr><td colSpan={5} className="muted">No assigned tasks in scope.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <details className="panel">
            <summary className="panel-body small" style={{ cursor: "pointer" }}>Weekly numbers as a table</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Week of</th><th className="num">Created</th><th className="num">Completed</th><th className="num">Avg cycle (days)</th></tr></thead>
                <tbody>{data.weekly.map((w) => <tr key={w.week}><td>{shortDate(w.week)}</td><td className="num">{w.created}</td><td className="num">{w.completed}</td><td className="num">{w.cycle_days ?? "—"}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
