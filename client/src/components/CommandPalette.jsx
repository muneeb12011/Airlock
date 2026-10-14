import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";
import api from "../api";
import { Avatar, StatusPill, TaskKey } from "./ui";

// ⌘K / Ctrl+K: jump to any task (by text or key like WEB-12), project,
// person or page.
export default function CommandPalette({ onClose, nav }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    if (!q.trim()) return setRes(null);
    const id = setTimeout(() => {
      api.get("/search", { params: { q: q.trim() } }).then(({ data }) => setRes(data)).catch(() => {});
    }, 150);
    return () => clearTimeout(id);
  }, [q]);

  const items = useMemo(() => {
    const out = [];
    const term = q.trim().toLowerCase();
    for (const n of nav) if (!term || n.label.toLowerCase().includes(term)) out.push({ group: "Go to", key: `nav-${n.to}`, go: n.to, render: <><n.icon size={16} /> {n.label}</> });
    if (res) {
      for (const t of res.tasks) out.push({ group: "Tasks", key: `t-${t.id}`, go: `/tasks?task=${t.id}`, render: <><TaskKey k={t.key} color={t.project_color} /><span className="grow ellipsis">{t.title}</span><StatusPill status={t.status} /></> });
      for (const p of res.projects) out.push({ group: "Projects", key: `p-${p.id}`, go: `/projects/${p.id}`, render: <><TaskKey k={p.key} color={p.color} /><span className="grow ellipsis">{p.name}</span>{p.status === "archived" && <span className="tag">archived</span>}</> });
      for (const u of res.people) out.push({ group: "People", key: `u-${u.id}`, go: `/messages?with=${u.id}`, render: <><Avatar name={u.name} id={u.id} src={u.avatar_url} size="sm" /><span className="grow ellipsis">{u.name}</span><span className="tag">{u.title || u.role}</span></> });
    }
    return out;
  }, [q, res, nav]);

  useEffect(() => setSel(0), [items.length]);
  const go = (item) => {
    if (!item) return;
    navigate(item.go);
    onClose();
  };

  let lastGroup = null;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="row" style={{ paddingLeft: 16 }}>
          <Search size={18} color="var(--faint)" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, projects, people — or type a key like WEB-12"
            aria-label="Search"
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === "Enter") go(items[sel]);
            }}
          />
        </div>
        <div className="results" role="listbox">
          {items.length === 0 && <div className="empty small">{q ? "No matches." : "Start typing to search."}</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="group">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {head}
                <button type="button" role="option" aria-selected={i === sel} className="hit" onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
                  {it.render}
                  {i === sel && <CornerDownLeft size={14} color="var(--faint)" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}
