import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, X, Send, Trash2, Webhook, Globe, Mail, ShieldCheck, Copy } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { timeAgo } from "../lib/format";
import { API_URL } from "../lib/config";
import { Button, Callout, Empty, Field, Modal, Skeleton, Switch } from "../components/ui";
import ChipInput from "../components/ChipInput";

function useSettings() {
  const [s, setS] = useState(null);
  const refreshAuth = useAuth((x) => x.refresh);
  const load = useCallback(() => api.get("/admin/settings").then(({ data }) => setS(data)).catch(async (e) => toast.bad(await errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);
  const save = async (patch, msg = "Saved") => {
    try {
      const { data } = await api.patch("/admin/settings", patch);
      setS((prev) => ({ ...prev, ...data }));
      refreshAuth().catch(() => {});
      toast.ok(msg);
      return true;
    } catch (err) {
      toast.bad(await errorMessage(err));
      return false;
    }
  };
  return [s, save];
}

function General() {
  const [s, save] = useSettings();
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (s && !form) setForm({ workspace_name: s.workspace_name, default_due_days: s.default_due_days, retention_days: s.retention_days, channels: s.channels, member_dm: s.member_dm });
  }, [s, form]);
  if (!form) return <Skeleton h={240} />;
  const submit = (e) => {
    e.preventDefault();
    save({ ...form, default_due_days: Number(form.default_due_days), retention_days: Number(form.retention_days) }, "Workspace settings saved");
  };
  return (
    <form className="panel panel-list" style={{ maxWidth: 760 }} onSubmit={submit}>
      <div className="panel-body col gap-16">
        <Field label="Workspace name" hint="Shown on the sign-in page, in emails and in the sidebar." htmlFor="ws-name">
          <input id="ws-name" className="input" value={form.workspace_name} onChange={(e) => setForm({ ...form, workspace_name: e.target.value })} required minLength={2} maxLength={60} />
        </Field>
        <div className="form-grid">
          <Field label="Default due date for new tasks" hint="Days from today. 0 = no default." htmlFor="ws-due">
            <input id="ws-due" className="input" type="number" min={0} max={90} value={form.default_due_days} onChange={(e) => setForm({ ...form, default_due_days: e.target.value })} />
          </Field>
          <Field label="Keep notifications and sign-in history for" hint="Days. The audit log is never deleted." htmlFor="ws-ret">
            <input id="ws-ret" className="input" type="number" min={30} max={3650} value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: e.target.value })} />
          </Field>
        </div>
        <Field label="Marketing channels" hint="Offered on content tasks and shown on the content calendar.">
          <ChipInput value={form.channels} onChange={(channels) => setForm({ ...form, channels })} placeholder="Add a channel" max={30} label="Channels" />
        </Field>
        <Field label="Who can message whom" htmlFor="ws-dm" hint="Admins and managers can always message anyone, and everyone can always message them.">
          <select id="ws-dm" className="select input" value={form.member_dm} onChange={(e) => setForm({ ...form, member_dm: e.target.value })}>
            <option value="off">Members can only message admins and managers (most locked down)</option>
            <option value="team">Members can also message people who share a team or project</option>
            <option value="all">Everyone can message everyone</option>
          </select>
        </Field>
      </div>
      <div className="panel-body"><Button type="submit" variant="primary">Save changes</Button></div>
    </form>
  );
}

function Access() {
  const [s, save] = useSettings();
  const [origin, setOrigin] = useState("");
  if (!s) return <Skeleton h={240} />;
  const add = async (e) => {
    e.preventDefault();
    const o = origin.trim().replace(/\/$/, "");
    if (!o) return;
    if (await save({ extra_origins: [...new Set([...(s.extra_origins || []), o])] }, `${o} can now reach the API`)) setOrigin("");
  };
  const remove = (o) => save({ extra_origins: s.extra_origins.filter((x) => x !== o) }, `${o} removed`);
  return (
    <div className="col gap-16" style={{ maxWidth: 760 }}>
      <section className="panel">
        <div className="panel-head"><h2 className="h2 row"><Globe size={16} /> Allowed web origins (CORS)</h2></div>
        <div className="panel-body col gap-12">
          <p className="small muted" style={{ margin: 0 }}>
            Browsers only let these sites call the API and open live connections. Add your staging site, a custom domain, or a
            second frontend here — no redeploy needed. Changes apply within about 15 seconds.
          </p>
          {s.env_origins.map((o) => (
            <div key={o} className="origin-row"><span className="grow">{o}</span><span className="tiny faint" style={{ fontFamily: "var(--font)" }}>from FRONTEND_URL — change in server env</span></div>
          ))}
          {(s.extra_origins || []).map((o) => (
            <div key={o} className="origin-row"><span className="grow">{o}</span><Button size="sm" variant="ghost" icon={<X />} aria-label={`Remove ${o}`} onClick={() => remove(o)} /></div>
          ))}
          {!s.env_origins.length && !(s.extra_origins || []).length && <Callout tone="warn">No origins are allowed. In production, browsers will be refused until you add your frontend's address.</Callout>}
          <form className="row" onSubmit={add}>
            <input className="input mono" placeholder="https://staging.yourcompany.com" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="New origin" />
            <Button type="submit" icon={<Plus />} disabled={!origin.trim()}>Add</Button>
          </form>
          <span className="tiny muted">https only (http is allowed for localhost). Origin only — no paths.</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="h2 row"><ShieldCheck size={16} /> Server configuration</h2></div>
        <div className="panel-list">
          <div className="posture-row"><Mail /><div className="grow small"><b>Email</b> — {s.email_enabled ? "configured. Invites and password resets are sent by email." : "not configured. Set SMTP_URL and MAIL_FROM on the server to send invites and password-reset links."}</div><span className={`pill ${s.email_enabled ? "ok" : "warn"}`}>{s.email_enabled ? "On" : "Off"}</span></div>
          <div className="posture-row"><ShieldCheck /><div className="grow small"><b>Virus scanning (ClamAV)</b> — {s.clamav_enabled ? "every upload is also scanned by ClamAV." : "File Shield's built-in checks only. Set CLAMAV_HOST for signature scanning."}</div><span className={`pill ${s.clamav_enabled ? "ok" : ""}`}>{s.clamav_enabled ? "On" : "Off"}</span></div>
          <div className="posture-row"><Globe /><div className="grow small"><b>Export networks</b> — {s.admin_allowed_ips.length ? `deliverable exports only from ${s.admin_allowed_ips.join(", ")}` : "exports allowed from any network. Set ADMIN_ALLOWED_IPS to restrict."}</div></div>
          <div className="posture-row"><Globe /><div className="grow small"><b>Proxy hops trusted</b> — {s.trust_proxy} (TRUST_PROXY). Must match your hosting so client IPs can't be faked.</div></div>
        </div>
      </section>
    </div>
  );
}

const FORMATS = { slack: "Slack incoming webhook", discord: "Discord webhook", json: "Any HTTPS endpoint (signed JSON)" };

function WebhookForm({ events, onClose, onSaved }) {
  const [f, setF] = useState({ name: "", url: "", format: "slack", events: ["task.submitted", "task.approved"] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/integrations/webhooks", f);
      onSaved(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't add the webhook."));
      setBusy(false);
    }
  };
  const toggle = (ev) => setF((x) => ({ ...x, events: x.events.includes(ev) ? x.events.filter((e) => e !== ev) : [...x.events, ev] }));
  return (
    <Modal title="Add a webhook" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="wh-form" loading={busy}>Add webhook</Button></>}>
      <form id="wh-form" className="col gap-16" onSubmit={submit}>
        <Field label="Name" htmlFor="wh-name"><input id="wh-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} placeholder="#marketing-approvals" /></Field>
        <Field label="Where to" htmlFor="wh-format">
          <select id="wh-format" className="select input" value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })}>
            {Object.entries(FORMATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Webhook URL" htmlFor="wh-url" hint="Stored encrypted. Must be https:// and on the public internet.">
          <input id="wh-url" className="input mono" type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} required placeholder="https://hooks.slack.com/services/…" />
        </Field>
        <Field label="Send when">
          <div className="col gap-4">
            {Object.entries(events).map(([k, l]) => (
              <label key={k} className="check-item" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={f.events.includes(k)} onChange={() => toggle(k)} /> <span>{l}</span>
              </label>
            ))}
          </div>
        </Field>
        {error && <Callout tone="bad">{error}</Callout>}
      </form>
    </Modal>
  );
}

function Integrations() {
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState(null);
  const load = useCallback(() => api.get("/integrations/webhooks").then(({ data }) => setData(data)).catch(async (e) => toast.bad(await errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);
  const test = async (h) => {
    const { data: r } = await api.post(`/integrations/webhooks/${h.id}/test`).catch(() => ({ data: { error: "request failed" } }));
    r.error ? toast.bad(`Test failed: ${r.error}`) : toast.ok(`Delivered (HTTP ${r.status})`);
    load();
  };
  const toggle = async (h, active) => {
    await api.patch(`/integrations/webhooks/${h.id}`, { active }).catch(async (e) => toast.bad(await errorMessage(e)));
    load();
  };
  const remove = async (h) => {
    if (!window.confirm(`Delete the webhook “${h.name}”?`)) return;
    await api.delete(`/integrations/webhooks/${h.id}`).catch(() => {});
    load();
  };
  if (!data) return <Skeleton h={200} />;
  return (
    <div className="col gap-16" style={{ maxWidth: 860 }}>
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0, maxWidth: "62ch" }}>
          Post updates to Slack or Discord channels, or trigger your own automation. Deliveries never slow down the app; a webhook that fails 20 times in a row is paused.
        </p>
        <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>Add webhook</Button>
      </div>
      {data.webhooks.length === 0 ? (
        <div className="panel"><Empty icon={<Webhook />} title="No webhooks yet">e.g. post to #marketing whenever content is approved, or to #eng when work is submitted for review.</Empty></div>
      ) : (
        <div className="panel panel-list">
          {data.webhooks.map((h) => (
            <div key={h.id} className="panel-body col gap-8">
              <div className="row between wrap gap-12">
                <div className="col gap-4" style={{ minWidth: 0 }}>
                  <b>{h.name}</b>
                  <span className="small muted mono ellipsis">{FORMATS[h.format]} · {h.url_hint}</span>
                </div>
                <div className="row">
                  <Switch label={`${h.name} active`} checked={h.active} onChange={(v) => toggle(h, v)} />
                  <Button size="sm" icon={<Send />} onClick={() => test(h)}>Test</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${h.name}`} onClick={() => remove(h)} />
                </div>
              </div>
              <div className="labels">{h.events.map((e) => <span key={e} className="label-chip">{data.events[e] || e}</span>)}</div>
              <span className="tiny muted">
                {h.last_sent_at ? <>Last delivery {timeAgo(h.last_sent_at)}: {h.last_error ? <b style={{ color: "var(--breach)" }}>{h.last_error}</b> : <span style={{ color: "var(--seal)" }}>OK ({h.last_status})</span>}</> : "Nothing sent yet."}
                {!h.active && h.failure_count >= 20 && " · paused after repeated failures"}
              </span>
            </div>
          ))}
        </div>
      )}
      <section className="panel">
        <div className="panel-head"><h2 className="h2">For developers</h2></div>
        <div className="panel-body col gap-8 small">
          <p style={{ margin: 0 }}>
            Signed JSON webhooks include <code>X-Airlock-Signature: sha256=…</code>, an HMAC of <code>{"{timestamp}.{body}"}</code> using the secret shown when you create the webhook, plus <code>X-Airlock-Timestamp</code>. Reject requests older than five minutes.
          </p>
          <p style={{ margin: 0 }}>
            Scripts and CI can call the API at <code>{API_URL}</code> with a personal token from <b>Profile → API tokens</b>: <code>Authorization: Bearer alk_…</code>
          </p>
        </div>
      </section>
      {adding && <WebhookForm events={data.events} onClose={() => setAdding(false)} onSaved={(h) => { setAdding(false); if (h.secret) setSecret(h); else toast.ok("Webhook added"); load(); }} />}
      {secret && (
        <Modal title="Save the signing secret" onClose={() => setSecret(null)} footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
          <p className="muted" style={{ margin: 0 }}>Your endpoint uses this to verify deliveries really came from this workspace. It won't be shown again.</p>
          <div className="recovery-grid" style={{ gridTemplateColumns: "1fr", wordBreak: "break-all" }}>{secret.secret}</div>
          <div><Button size="sm" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(secret.secret).then(() => toast.ok("Copied"))}>Copy</Button></div>
        </Modal>
      )}
    </div>
  );
}

const TABS = [["general", "General"], ["access", "Access & CORS"], ["integrations", "Integrations"]];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "general";
  return (
    <div className="col gap-16">
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === "general" ? {} : { tab: k })}>{l}</button>)}
      </div>
      {tab === "general" && <General />}
      {tab === "access" && <Access />}
      {tab === "integrations" && <Integrations />}
    </div>
  );
}
