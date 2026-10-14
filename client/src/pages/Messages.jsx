import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, ArrowLeft, Zap, CheckCheck, Check, MessageSquare, Paperclip } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import useLive from "../store/live";
import { toast } from "../store/toast";
import { getSocket } from "../socket";
import { download, errorMessage } from "../lib/download";
import { clock, dayLabel, timeAgo } from "../lib/format";
import { Avatar, Button, Callout, Empty, FileChip, Skeleton } from "../components/ui";
import FilePicker from "../components/FilePicker";
import { sendDirect, useTransferBusy } from "../components/DirectTransfer";

function Thread({ contact, onBack, onActivity }) {
  const me = useAuth((s) => s.user);
  const settings = useAuth((s) => s.settings);
  const online = useLive((s) => s.online.has(String(contact.id)));
  const lastMessage = useLive((s) => s.lastMessage);
  const lastRead = useLive((s) => s.lastRead);
  const typing = useLive((s) => s.typingFrom);
  const transferBusy = useTransferBusy();
  const [messages, setMessages] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [, tick] = useState(0);
  const scroller = useRef(null);
  const stickToBottom = useRef(true);
  const lastTyping = useRef(0);
  const directInput = useRef(null);

  const load = useCallback(async (before) => {
    const { data } = await api.get(`/messages/${contact.id}`, { params: { before } });
    setHasMore(data.has_more);
    return data.messages;
  }, [contact.id]);

  useEffect(() => {
    setMessages(null);
    stickToBottom.current = true;
    load().then((m) => { setMessages(m); onActivity(); }).catch(async (err) => toast.bad(await errorMessage(err)));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live incoming/outgoing messages for this conversation.
  useEffect(() => {
    if (!lastMessage || !messages) return;
    const ours = [lastMessage.sender_id, lastMessage.recipient_id].includes(contact.id);
    if (!ours || messages.some((m) => m.id === lastMessage.id)) return;
    setMessages((list) => [...list, lastMessage]);
    if (lastMessage.sender_id === contact.id) api.post(`/messages/${contact.id}/read`).catch(() => {});
    onActivity();
  }, [lastMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lastRead || lastRead.by !== contact.id) return;
    const ids = new Set(lastRead.ids);
    setMessages((list) => list?.map((m) => (ids.has(m.id) ? { ...m, read_at: new Date().toISOString() } : m)));
  }, [lastRead, contact.id]);

  useEffect(() => {
    if (typing?.from !== contact.id) return undefined;
    const id = setTimeout(() => tick((n) => n + 1), 3200);
    return () => clearTimeout(id);
  }, [typing, contact.id]);
  const isTyping = typing?.from === contact.id && Date.now() - typing.at < 3000;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  const older = async () => {
    const el = scroller.current;
    const prevHeight = el.scrollHeight;
    stickToBottom.current = false;
    const page = await load(messages[0]?.id);
    setMessages((list) => [...page, ...list]);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevHeight; });
  };

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !file) return;
    setSending(true);
    setBlocked(null);
    stickToBottom.current = true;
    const fd = new FormData();
    if (text.trim()) fd.append("message", text.trim());
    if (file) fd.append("file", file);
    if (file) setProgress(0);
    try {
      const { data } = await api.post(`/messages/${contact.id}`, fd, {
        onUploadProgress: (p) => file && p.total && setProgress(Math.round((p.loaded / p.total) * 100)),
      });
      setMessages((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
      setText("");
      setFile(null);
      onActivity();
    } catch (err) {
      const reasons = err.response?.data?.reasons;
      if (reasons) setBlocked(reasons);
      else toast.bad(await errorMessage(err, "Message not sent."));
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const onType = (e) => {
    setText(e.target.value);
    e.target.style.height = "38px";
    e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      getSocket()?.emit("typing", { to: contact.id });
    }
  };

  const grab = async (m) => {
    setDownloading(m.id);
    try {
      const r = await download(`/messages/file/${m.id}`, m.file?.name || m.legacy_file_name || "attachment");
      if (r.sha256 && m.file && r.sha256 === m.file.sha256) toast.ok("Downloaded. Fingerprint matches the original upload.");
    } catch (err) {
      toast.bad(await errorMessage(err, "Download failed."));
    } finally {
      setDownloading(null);
    }
  };

  let lastDay = null;

  return (
    <div className="thread">
      <div className="thread-head">
        <Button variant="ghost" size="sm" className="mobile-only" icon={<ArrowLeft />} aria-label="Back to conversations" onClick={onBack} />
        <Avatar name={contact.name} id={contact.id} src={contact.avatar_url} showPresence />
        <div className="grow col" style={{ gap: 0 }}>
          <b>{contact.name}</b>
          <span className="tiny muted">{isTyping ? "typing…" : online ? "Online" : "Offline"}{contact.role === "admin" ? " · Admin" : ""}</span>
        </div>
        {settings.allow_p2p && (
          <>
            <Button
              size="sm"
              icon={<Zap />}
              disabled={!online || transferBusy}
              title={online ? "Send a file straight to their browser. Not scanned by File Shield." : `${contact.name} is offline`}
              onClick={() => directInput.current?.click()}
            >
              <span className="hide-sm">Direct transfer</span>
            </Button>
            <input ref={directInput} type="file" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) sendDirect(f, contact.id, contact.name); }} />
          </>
        )}
      </div>

      <div className="messages" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {hasMore && <Button size="sm" style={{ alignSelf: "center" }} onClick={older}>Load older messages</Button>}
        {!messages ? (
          <div className="col gap-8"><Skeleton h={34} w="50%" /><Skeleton h={34} w="40%" style={{ alignSelf: "flex-end" }} /></div>
        ) : messages.length === 0 ? (
          <Empty icon={<MessageSquare />} title={`Start a conversation with ${contact.name.split(" ")[0]}`}>Messages and files stay inside Airlock. Every attachment is checked by File Shield.</Empty>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === me.id;
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <Fragment key={m.id}>
                {showDay && <div className="day-sep">{day}</div>}
                <div className={`bubble ${mine ? "mine" : ""}`}>
                  {m.message && <div className="prose">{m.message}</div>}
                  {(m.file || m.has_legacy_file) && <FileChip file={m.file} legacyName={m.legacy_file_name} onDownload={() => grab(m)} downloading={downloading === m.id} />}
                  <div className="bubble-meta">
                    <span className={mine ? "" : "faint"} title={new Date(m.created_at).toLocaleString()}>{clock(m.created_at)}</span>
                    {mine && (m.read_at ? <CheckCheck size={13} aria-label="Read" /> : <Check size={13} aria-label="Sent" />)}
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
        {isTyping && <div className="bubble faint small">typing…</div>}
      </div>

      {(file || blocked) && (
        <div style={{ padding: "10px 12px 0", background: "var(--panel)" }} className="col gap-8">
          {blocked && (
            <Callout tone="bad" title="File Shield blocked that file">
              <ul>{blocked.map((r) => <li key={r}>{r}</li>)}</ul>
            </Callout>
          )}
          {file && <FilePicker file={file} onChange={setFile} />}
          {progress !== null && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}
        </div>
      )}
      <form className="composer" onSubmit={send}>
        <FilePicker compact file={null} onChange={(f) => { setFile(f); setBlocked(null); }} disabled={sending} />
        <textarea
          className="textarea grow"
          placeholder={`Message ${contact.name.split(" ")[0]}`}
          value={text}
          onChange={onType}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          maxLength={8000}
          aria-label="Message"
        />
        <Button type="submit" variant="primary" icon={<Send />} loading={sending} disabled={!text.trim() && !file} aria-label="Send" />
      </form>
    </div>
  );
}

export default function Messages() {
  const [contacts, setContacts] = useState(null);
  const [params, setParams] = useSearchParams();
  const me = useAuth((s) => s.user);
  const lastMessage = useLive((s) => s.lastMessage);
  const setUnread = useLive((s) => s.setUnreadMessages);
  const withId = Number(params.get("with")) || null;

  const loadContacts = useCallback(() => {
    api.get("/messages/conversations").then(({ data }) => {
      setContacts(data);
      setUnread(data.reduce((n, c) => n + c.unread, 0));
    }).catch(async (err) => toast.bad(await errorMessage(err)));
  }, [setUnread]);

  useEffect(loadContacts, [loadContacts, lastMessage]);

  // Members usually have one admin: open that conversation straight away.
  useEffect(() => {
    if (!withId && contacts?.length === 1 && window.innerWidth > 860) setParams({ with: String(contacts[0].id) }, { replace: true });
  }, [contacts, withId, setParams]);

  const contact = contacts?.find((c) => c.id === withId);

  return (
    <div className={`panel chat ${contact ? "has-thread" : ""}`}>
      <div className="contacts" role="list" aria-label="Conversations">
        {!contacts && <div className="panel-body col gap-12"><Skeleton h={36} /><Skeleton h={36} /></div>}
        {contacts?.length === 0 && (
          <Empty title="No one to message yet">{me.role === "admin" ? "Add team members on the Team page." : "Your admin hasn't been set up yet."}</Empty>
        )}
        {contacts?.map((c) => (
          <button key={c.id} type="button" role="listitem" className={`contact ${c.id === withId ? "active" : ""}`} onClick={() => setParams({ with: String(c.id) })}>
            <Avatar name={c.name} id={c.id} src={c.avatar_url} showPresence />
            <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
              <span className="row between">
                <b className="ellipsis">{c.name}</b>
                {c.last_at && <span className="tiny faint nowrap">{timeAgo(c.last_at)}</span>}
              </span>
              <span className="small muted ellipsis">
                {c.last_at ? (
                  <>
                    {c.last_sender_id === me.id && "You: "}
                    {c.last_message || (c.last_has_file && <><Paperclip size={11} /> File</>)}
                  </>
                ) : (
                  <span className="faint">{c.role === "admin" ? "Admin" : "No messages yet"}</span>
                )}
              </span>
            </span>
            {c.unread > 0 && <span className="unread" aria-label={`${c.unread} unread`}>{c.unread}</span>}
          </button>
        ))}
      </div>
      {contact ? (
        <Thread key={contact.id} contact={contact} onBack={() => setParams({})} onActivity={loadContacts} />
      ) : (
        <div className="thread" style={{ display: "grid", placeItems: "center" }}>
          <Empty icon={<MessageSquare />} title="Pick a conversation">Choose someone on the left.</Empty>
        </div>
      )}
    </div>
  );
}
