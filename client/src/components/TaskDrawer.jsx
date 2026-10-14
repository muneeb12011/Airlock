import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play, Send, Check, RotateCcw, Pencil, Trash2, FileDown, Hourglass, MessageSquare, CircleCheck, Copy as CopyIcon,
  Link2, Plus, X, ListChecks, Ban, History, GitPullRequest, PenTool, FileText, ExternalLink,
} from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useLive from "../store/live";
import useWorkspace from "../store/workspace";
import { toast } from "../store/toast";
import { download, errorMessage } from "../lib/download";
import { describe } from "../lib/activity";
import { TYPES, dateTime, timeAgo, STATUS } from "../lib/format";
import { Avatar, Button, Callout, Drawer, Due, FileChip, Labels, Priority, Skeleton, StatusPill, TaskKey } from "./ui";
import FilePicker from "./FilePicker";
import TaskForm from "./TaskForm";

function SubmitWork({ task, onDone }) {
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    if (notes.trim()) fd.append("notes", notes.trim());
    if (file) fd.append("file", file);
    setProgress(0);
    try {
      await api.post(`/tasks/${task.id}/submit`, fd, {
        onUploadProgress: (p) => p.total && setProgress(Math.round((p.loaded / p.total) * 100)),
      });
      toast.ok("Submitted for review");
      onDone();
    } catch (err) {
      setError({ text: await errorMessage(err, "Couldn't submit."), reasons: err.response?.data?.reasons });
      setProgress(null);
    }
  };

  const openItems = (task.checklist || []).filter((c) => !c.done).length;

  return (
    <form className="col gap-12" onSubmit={submit}>
      <h3 className="h2">Submit your work</h3>
      {openItems > 0 && <Callout tone="warn">{openItems} checklist item{openItems === 1 ? " is" : "s are"} still open. You can submit anyway.</Callout>}
      <textarea className="textarea" placeholder="What did you do? Anything the reviewer should check?" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={20000} aria-label="Submission notes" />
      <FilePicker file={file} onChange={setFile} />
      {progress !== null && file && (
        <div className="col gap-4">
          <div className="progress"><i style={{ width: `${progress}%` }} /></div>
          <span className="tiny muted">{progress < 100 ? `Uploading ${progress}%` : "Scanning with File Shield…"}</span>
        </div>
      )}
      {error && (
        <Callout tone="bad" title={error.reasons ? "File Shield blocked this file" : undefined}>
          {error.reasons ? <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : error.text}
        </Callout>
      )}
      <div>
        <Button type="submit" variant="primary" icon={<Send />} loading={progress !== null} disabled={!notes.trim() && !file}>Submit for review</Button>
      </div>
    </form>
  );
}

function ReviewPanel({ task, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const decide = async (decision) => {
    if (decision === "changes" && !note.trim()) return toast.bad("Write what needs to change first.");
    setBusy(decision);
    try {
      await api.post(`/tasks/${task.id}/review`, { decision, note: note.trim() || undefined });
      toast.ok(decision === "approve" ? "Approved and marked done" : "Sent back with your notes");
      onDone();
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="panel panel-body col gap-12" style={{ borderColor: "var(--signal-line)", background: "var(--signal-tint)" }}>
      <div className="row"><Hourglass size={18} color="var(--signal)" /><h3 className="h2">Waiting for your review</h3></div>
      <textarea className="textarea" placeholder="Feedback for the assignee (required if you request changes)" value={note} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Review feedback" />
      <div className="row wrap">
        <Button variant="primary" icon={<Check />} loading={busy === "approve"} disabled={!!busy} onClick={() => decide("approve")}>Approve</Button>
        <Button icon={<RotateCcw />} loading={busy === "changes"} disabled={!!busy} onClick={() => decide("changes")}>Request changes</Button>
      </div>
    </div>
  );
}

function Checklist({ task, canEdit, onChange }) {
  const [items, setItems] = useState(task.checklist || []);
  const [text, setText] = useState("");
  useEffect(() => setItems(task.checklist || []), [task.checklist]);
  const done = items.filter((i) => i.done).length;

  const toggle = async (item) => {
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      await api.patch(`/tasks/${task.id}/checklist/${item.id}`, { done: !item.done });
      onChange();
    } catch (err) {
      toast.bad(await errorMessage(err));
      setItems(task.checklist || []);
    }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const { data } = await api.post(`/tasks/${task.id}/checklist`, { text: text.trim() });
      setItems((l) => [...l, data]);
      setText("");
      onChange();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async (item) => {
    setItems((l) => l.filter((i) => i.id !== item.id));
    await api.delete(`/tasks/${task.id}/checklist/${item.id}`).catch(() => {});
    onChange();
  };

  if (!items.length && !canEdit) return null;
  return (
    <section className="col gap-8">
      <div className="row between">
        <h3 className="h2 row"><ListChecks size={16} /> Checklist</h3>
        {items.length > 0 && <span className="small muted">{done} of {items.length} done</span>}
      </div>
      {items.length > 0 && <div className="meter"><i style={{ width: `${(done / items.length) * 100}%`, background: "var(--seal)" }} /></div>}
      <div className="col" style={{ gap: 0 }}>
        {items.map((i) => (
          <label key={i.id} className={`check-item ${i.done ? "done" : ""}`}>
            <input type="checkbox" checked={i.done} disabled={!canEdit} onChange={() => toggle(i)} />
            <span className="grow">{i.text}</span>
            {canEdit && <button type="button" className="btn ghost sm icon del" aria-label={`Remove ${i.text}`} onClick={(e) => { e.preventDefault(); remove(i); }}><X /></button>}
          </label>
        ))}
      </div>
      {canEdit && (
        <form className="row" onSubmit={add}>
          <input className="input" placeholder="Add an item" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="New checklist item" />
          <Button type="submit" icon={<Plus />} disabled={!text.trim()} aria-label="Add item" />
        </form>
      )}
    </section>
  );
}

const LINK_ICONS = { github_pr: GitPullRequest, github_issue: GitPullRequest, github_commit: GitPullRequest, gitlab_mr: GitPullRequest, figma: PenTool, google_doc: FileText, notion: FileText };
const LINK_LABELS = { github_pr: "Pull request", github_issue: "Issue", github_commit: "Commit", gitlab_mr: "Merge request", figma: "Figma", google_doc: "Google Doc", google_drive: "Drive", notion: "Notion", canva: "Canva", preview: "Preview" };

function Links({ task, me, canManage, onChange }) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tasks/${task.id}/links`, { url: url.trim() });
      setUrl("");
      setAdding(false);
      onChange();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async (l) => {
    await api.delete(`/tasks/${task.id}/links/${l.id}`).catch(async (err) => toast.bad(await errorMessage(err)));
    onChange();
  };
  return (
    <section className="col gap-8">
      <div className="row between">
        <h3 className="h2 row"><Link2 size={16} /> Links</h3>
        {!adding && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>Add link</Button>}
      </div>
      {task.links.length === 0 && !adding && <p className="small muted" style={{ margin: 0 }}>Pull requests, designs, docs, previews — anything the reviewer should open.</p>}
      {task.links.map((l) => {
        const Icon = LINK_ICONS[l.kind] || ExternalLink;
        let host = "";
        try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
        return (
          <div key={l.id} className="link-row">
            <Icon size={16} color="var(--muted)" />
            <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="grow ellipsis">{l.title || l.url.replace(/^https?:\/\//, "")}</a>
            {LINK_LABELS[l.kind] ? <span className="link-kind">{LINK_LABELS[l.kind]}</span> : <span className="tiny faint">{host}</span>}
            {(canManage || l.added_by_name === me.name) && <button type="button" className="btn ghost sm icon" aria-label="Remove link" onClick={() => remove(l)}><X /></button>}
          </div>
        );
      })}
      {adding && (
        <form className="row" onSubmit={add}>
          <input className="input" type="url" autoFocus placeholder="https://github.com/org/repo/pull/123" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link URL" required />
          <Button type="submit" variant="primary">Add</Button>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      )}
    </section>
  );
}

function Dependencies({ task, canManage, onChange, onOpen }) {
  const [key, setKey] = useState("");
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tasks/${task.id}/dependencies`, { depends_on: key.trim().toUpperCase() });
      setKey("");
      onChange();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const remove = async (d) => {
    await api.delete(`/tasks/${task.id}/dependencies/${d.id}`).catch(() => {});
    onChange();
  };
  if (!task.depends_on.length && !task.blocks.length && !canManage) return null;
  const row = (d, removable) => (
    <div key={d.id} className="row gap-8 small">
      <StatusPill status={d.status} />
      <button type="button" className="btn ghost sm" style={{ padding: "0 4px" }} onClick={() => onOpen(d.id)}>
        {d.key && <TaskKey k={d.key} />} <span className="ellipsis" style={{ maxWidth: 280 }}>{d.title}</span>
      </button>
      {removable && canManage && <button type="button" className="btn ghost sm icon" aria-label="Remove dependency" onClick={() => remove(d)}><X /></button>}
    </div>
  );
  return (
    <section className="col gap-8">
      <h3 className="h2 row"><Ban size={16} /> Dependencies</h3>
      {task.depends_on.length > 0 && <div className="col gap-4"><span className="tiny muted">Waits on</span>{task.depends_on.map((d) => row(d, true))}</div>}
      {task.blocks.length > 0 && <div className="col gap-4"><span className="tiny muted">Blocks</span>{task.blocks.map((d) => row(d, false))}</div>}
      {canManage && task.project_key && (
        <form className="row" onSubmit={add}>
          <input className="input mono" placeholder={`Waits on… e.g. ${task.project_key}-3`} value={key} onChange={(e) => setKey(e.target.value)} aria-label="Task key this depends on" maxLength={20} />
          <Button type="submit" disabled={!key.trim()}>Add</Button>
        </form>
      )}
    </section>
  );
}

// Comment box with @mention autocomplete. Mentions are sent as user ids.
function Comments({ task }) {
  const [items, setItems] = useState(null);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState([]);
  const [picker, setPicker] = useState(null); // { query, index }
  const [busy, setBusy] = useState(false);
  const version = useLive((s) => s.taskVersion);
  const me = useAuth((s) => s.user);
  const { people, loadPeople } = useWorkspace();
  const area = useRef(null);
  useEffect(() => { loadPeople().catch(() => {}); }, [loadPeople]);

  useEffect(() => {
    api.get(`/tasks/${task.id}/comments`).then(({ data }) => setItems(data)).catch(() => setItems([]));
  }, [task.id, version]);

  const matches = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    return (people || []).filter((p) => p.id !== me.id && p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [picker, people, me.id]);

  const onType = (e) => {
    const v = e.target.value;
    setText(v);
    const upto = v.slice(0, e.target.selectionStart);
    const m = upto.match(/(?:^|\s)@([\w.-]{0,30})$/);
    setPicker(m ? { query: m[1], index: 0 } : null);
  };
  const choose = (p) => {
    const el = area.current;
    const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@([\w.-]{0,30})$/, `@${p.name.split(" ")[0]} `);
    setText(before + text.slice(pos));
    setMentions((m) => [...new Set([...m, p.id])]);
    setPicker(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const firstNames = new Set((people || []).filter((p) => mentions.includes(p.id) && text.includes(`@${p.name.split(" ")[0]}`)).map((p) => p.id));
      const { data } = await api.post(`/tasks/${task.id}/comments`, { message: text.trim(), mentions: [...firstNames] });
      setItems((list) => [...(list || []).filter((c) => c.id !== data.id), data]);
      setText("");
      setMentions([]);
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const render = (msg) =>
    msg.split(/(@[\w.-]+)/g).map((part, i) =>
      part.startsWith("@") && (people || []).some((p) => p.name.split(" ")[0] === part.slice(1)) ? <span key={i} className="mention">{part}</span> : part
    );

  return (
    <section className="col gap-12">
      <h3 className="h2 row"><MessageSquare size={16} /> Discussion</h3>
      {items === null ? <Skeleton h={40} /> : items.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>No comments yet. Type @ to bring someone in.</p>
      ) : (
        <div className="col gap-12">
          {items.map((c) => (
            <div key={c.id} className="row top gap-12">
              <Avatar name={c.author_name || "?"} id={c.user_id} src={c.author_avatar_url} size="sm" />
              <div className="grow">
                <div className="row gap-4 small">
                  <b>{c.user_id === me.id ? "You" : c.author_name || "Former member"}</b>
                  {c.author_role !== "member" && c.author_role && <span className="tag">{c.author_role}</span>}
                  <span className="faint tiny" title={dateTime(c.created_at)}>{timeAgo(c.created_at)}</span>
                </div>
                <div className="prose">{render(c.message)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="row top" onSubmit={send} style={{ position: "relative" }}>
        {picker && matches.length > 0 && (
          <div className="mention-pop" role="listbox" aria-label="Mention someone">
            {matches.map((p, i) => (
              <button key={p.id} type="button" role="option" aria-selected={i === picker.index} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                <Avatar name={p.name} id={p.id} src={p.avatar_url} size="sm" />
                <span className="col" style={{ gap: 0 }}><b className="small">{p.name}</b>{p.title && <span className="tiny muted">{p.title}</span>}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          className="textarea grow"
          style={{ minHeight: 40, height: 40 }}
          placeholder="Write a comment — @ to mention"
          value={text}
          onChange={onType}
          onKeyDown={(e) => {
            if (picker && matches.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setPicker((p) => ({ ...p, index: (p.index + 1) % matches.length })); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setPicker((p) => ({ ...p, index: (p.index - 1 + matches.length) % matches.length })); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[picker.index]); return; }
              if (e.key === "Escape") { setPicker(null); return; }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
          }}
          maxLength={4000}
          aria-label="Comment"
        />
        <Button type="submit" loading={busy} disabled={!text.trim()}>Post</Button>
      </form>
    </section>
  );
}

function HistoryList({ taskId }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get(`/tasks/${taskId}/history`).then(({ data }) => setItems(data)).catch(() => setItems([]));
  }, [taskId]);
  if (!items) return <Skeleton h={60} />;
  if (!items.length) return <p className="small muted">No history yet.</p>;
  return (
    <div className="col" style={{ gap: 0 }}>
      {items.map((e) => (
        <div key={e.id} className="feed-item" style={{ padding: "8px 0" }}>
          <span>{describe(e)}{e.meta?.changes && Object.keys(e.meta.changes).length > 0 && <span className="muted"> — {Object.keys(e.meta.changes).join(", ").replace(/_/g, " ")}</span>}</span>
          <time dateTime={e.created_at}>{timeAgo(e.created_at)}</time>
        </div>
      ))}
    </div>
  );
}

export default function TaskDrawer({ taskId, onClose, onChanged, onOpenTask }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [tab, setTab] = useState("work");
  const user = useAuth((s) => s.user);
  const version = useLive((s) => s.taskVersion);

  const load = useCallback(() => {
    api.get(`/tasks/${taskId}`).then(({ data }) => setTask(data)).catch(async (err) => setError(await errorMessage(err, "Couldn't load this task.")));
  }, [taskId]);
  useEffect(load, [load, version]);
  useEffect(() => setTab("work"), [taskId]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const act = async (key, fn, okText) => {
    setBusy(key);
    try {
      const r = await fn();
      if (okText) toast.ok(okText);
      changed();
      return r;
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    if (!window.confirm(`Delete “${task.title}”? Its submissions, files and comments are removed too. This can't be undone.`)) return;
    act("delete", () => api.delete(`/tasks/${task.id}`), "Task deleted").then(onClose);
  };
  const duplicate = async () => {
    const r = await act("dup", () => api.post(`/tasks/${task.id}/duplicate`), "Duplicated");
    if (r?.data?.id) onOpenTask?.(r.data.id);
  };
  const exportAs = (format) => act(format, () => download(`/admin/tasks/${task.id}/export?format=${format}`, `task-${task.id}.${format}`));
  const downloadSubmission = (s) =>
    act(`sub-${s.id}`, async () => {
      const r = await download(`/admin/submissions/${s.id}/file`, s.file?.name || s.legacy_file_name || "attachment");
      if (r.sha256 && s.file && r.sha256 === s.file.sha256) toast.ok("Downloaded. Fingerprint matches the original upload.");
    });

  const latest = task?.submissions?.[0];
  const isAssignee = task?.assigned_to === user.id;
  const canManage = Boolean(task?.can_manage);

  return (
    <Drawer
      onClose={onClose}
      header={
        task ? (
          <div className="col gap-8">
            <div className="row wrap gap-12">
              <TaskKey task={task} />
              <StatusPill status={task.status} />
              <Priority value={task.priority} />
              <span className="tag">{TYPES[task.type] || task.type}</span>
              <Due date={task.due_date} status={task.status} />
            </div>
            <h2 className="h1" style={{ fontSize: 21 }}>{task.title}</h2>
            <div className="row small muted gap-12 wrap">
              <span className="row gap-4"><Avatar name={task.assignee_name || "?"} id={task.assigned_to} src={task.assignee_avatar_url} size="sm" showPresence /> {task.assignee_name || "Unassigned"}</span>
              {task.project_name && <Link to={`/projects/${task.project_id}`} onClick={onClose}>{task.project_name}</Link>}
              <span>by {task.assigned_by_name || "—"} {timeAgo(task.created_at)}</span>
            </div>
          </div>
        ) : (
          <Skeleton h={60} />
        )
      }
    >
      {error && <Callout tone="bad">{error}</Callout>}
      {task && (
        <>
          {canManage && (
            <div className="row wrap">
              <Button size="sm" icon={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" icon={<CopyIcon />} loading={busy === "dup"} onClick={duplicate}>Duplicate</Button>
              {task.status === "completed" && <Button size="sm" icon={<RotateCcw />} loading={busy === "reopen"} onClick={() => act("reopen", () => api.post(`/tasks/${task.id}/reopen`), "Reopened")}>Reopen</Button>}
              {task.submission_count > 0 && (
                <>
                  <Button size="sm" icon={<FileDown />} loading={busy === "pdf"} onClick={() => exportAs("pdf")}>PDF</Button>
                  <Button size="sm" icon={<FileDown />} loading={busy === "docx"} onClick={() => exportAs("docx")}>Word</Button>
                </>
              )}
              <Button size="sm" variant="danger" icon={<Trash2 />} loading={busy === "delete"} onClick={remove} style={{ marginLeft: "auto" }}>Delete</Button>
            </div>
          )}

          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "work"} onClick={() => setTab("work")}>Work</button>
            <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}><History size={14} /> History</button>
          </div>

          {tab === "history" ? (
            <HistoryList taskId={task.id} />
          ) : (
            <>
              {canManage && task.status === "in_review" && <ReviewPanel task={task} onDone={changed} />}

              {task.is_blocked && task.status !== "completed" && (
                <Callout tone="warn" icon={Ban} title="Blocked">
                  Waits on {task.depends_on.filter((d) => d.status !== "completed").map((d) => d.key || d.title).join(", ")}.
                </Callout>
              )}

              {isAssignee && task.status === "pending" && (
                <div className="panel panel-body row between wrap">
                  <span className="muted">Starting tells your team you're on it.</span>
                  <Button variant="primary" icon={<Play />} loading={busy === "start"} onClick={() => act("start", () => api.post(`/tasks/${task.id}/start`), "Marked in progress")}>Start task</Button>
                </div>
              )}
              {isAssignee && task.status === "in_progress" && latest?.review_status === "changes_requested" && (
                <Callout tone="warn" title="Changes requested"><div className="prose">{latest.review_note}</div></Callout>
              )}
              {isAssignee && task.status === "in_review" && (
                <Callout icon={Hourglass} title="Submitted — waiting for review">You'll get a notification when it's approved or sent back.</Callout>
              )}
              {isAssignee && task.status === "completed" && <Callout tone="ok" icon={CircleCheck} title="Approved">Nice work. This task is done.</Callout>}

              <section className="col gap-8">
                <h3 className="h2">Details</h3>
                {task.description ? <div className="prose">{task.description}</div> : <p className="muted small" style={{ margin: 0 }}>No details were added.</p>}
                <div className="row wrap gap-12 small muted">
                  {task.labels?.length > 0 && <Labels labels={task.labels} max={10} />}
                  {task.channel && <span>Channel: <b style={{ color: "var(--ink)" }}>{task.channel}</b></span>}
                  {task.estimate != null && <span>Estimate: <b style={{ color: "var(--ink)" }}>{task.estimate} pts</b></span>}
                  {task.start_date && <span>Starts {task.start_date}</span>}
                </div>
              </section>

              <Checklist task={task} canEdit={isAssignee || canManage} onChange={changed} />
              <Links task={task} me={user} canManage={canManage} onChange={changed} />
              <Dependencies task={task} canManage={canManage} onChange={changed} onOpen={(id) => onOpenTask?.(id)} />

              {isAssignee && task.status === "in_progress" && <SubmitWork task={task} onDone={changed} />}

              {task.submissions.length > 0 && (
                <section className="col gap-12">
                  <h3 className="h2">Submissions</h3>
                  {task.submissions.map((s, i) => (
                    <div key={s.id} className="panel panel-body col gap-8" style={{ opacity: i === 0 ? 1 : 0.85 }}>
                      <div className="row between wrap">
                        <span className="small"><b>{s.submitted_by_name || "Former member"}</b> <span className="muted">submitted {timeAgo(s.submitted_at)}</span></span>
                        {s.review_status === "approved" && <span className="pill ok">Approved</span>}
                        {s.review_status === "changes_requested" && <span className="pill warn">Changes requested</span>}
                        {s.review_status === "pending" && <span className="pill in_review"><span className="lamp" />Awaiting review</span>}
                      </div>
                      {s.notes && <div className="prose">{s.notes}</div>}
                      {(s.file || s.has_legacy_file) && (
                        <FileChip file={s.file} legacyName={s.legacy_file_name} onDownload={canManage ? () => downloadSubmission(s) : undefined} downloading={busy === `sub-${s.id}`} />
                      )}
                      {s.review_note && (
                        <div className="small" style={{ borderLeft: "3px solid var(--line)", paddingLeft: 10 }}>
                          <span className="muted">{s.reviewed_by_name || "Reviewer"}:</span> {s.review_note}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}

              <Comments task={task} />
            </>
          )}
        </>
      )}
      {editing && (
        <TaskForm task={task} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.ok("Task updated"); changed(); }} />
      )}
    </Drawer>
  );
}

export { STATUS };
