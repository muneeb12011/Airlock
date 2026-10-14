import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Ban, Link2, ShieldCheck, ShieldX, MapPin } from "lucide-react";
import api from "../../api";
import useAuth from "../../store/auth";
import { toast } from "../../store/toast";
import { errorMessage } from "../../lib/download";
import { describe, isAlarming } from "../../lib/activity";
import { bytes, dateTime, timeAgo, userAgentLabel } from "../../lib/format";
import { Button, Callout, Empty, Fingerprint, Segmented, Skeleton, Switch } from "../../components/ui";

function Pager({ page, hasMore, onPage }) {
  if (page === 1 && !hasMore) return null;
  return (
    <div className="row between" style={{ padding: "10px 14px", borderTop: "1px solid var(--line-soft)" }}>
      <Button size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>Newer</Button>
      <span className="small muted">Page {page}</span>
      <Button size="sm" disabled={!hasMore} onClick={() => onPage(page + 1)}>Older</Button>
    </div>
  );
}

const REASONS = {
  bad_password: "Wrong password",
  unknown_email: "No such account",
  locked: "Account locked",
  disabled: "Account disabled",
  bad_2fa_code: "Wrong 2-step code",
  bad_recovery_code: "Bad recovery code",
  password: "Password",
  "password+2fa": "Password + 2-step",
  recovery_code: "Recovery code",
};

function SignIns() {
  const [result, setResult] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => {
      api.get("/admin/login-logs", { params: { result, q: q || undefined, page } }).then(({ data }) => setData(data)).catch(async (e) => toast.bad(await errorMessage(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [result, q, page]);

  return (
    <div className="col gap-12">
      <div className="row wrap gap-12">
        <Segmented label="Result" value={result} onChange={(v) => { setResult(v); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "success", label: "Successful" }]} />
        <div className="search" style={{ width: "min(300px, 100%)" }}>
          <Search />
          <input className="input" placeholder="Name, email or IP" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search sign-ins" />
        </div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Result</th><th>Network</th><th>Device</th></tr></thead>
            <tbody>
              {!data && <tr><td colSpan={5}><Skeleton h={18} /></td></tr>}
              {data?.items.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap" title={dateTime(l.login_at)}>{timeAgo(l.login_at)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.name || <span className="muted">Unknown account</span>}</div>
                    <div className="small muted">{l.email}</div>
                  </td>
                  <td>
                    {l.success ? <span className="pill ok">Signed in</span> : <span className="pill bad">Failed</span>}
                    <div className="tiny muted mt-4">{REASONS[l.reason] || l.reason}</div>
                  </td>
                  <td>
                    <span className="mono">{l.ip_address}</span>
                    {l.new_ip && <div className="mt-4"><span className="pill warn"><MapPin size={11} /> New network</span></div>}
                  </td>
                  <td className="small muted">{userAgentLabel(l.user_agent)}</td>
                </tr>
              ))}
              {data && data.items.length === 0 && <tr><td colSpan={5} className="muted">No sign-ins match.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} hasMore={data.has_more} onPage={setPage} />}
      </div>
    </div>
  );
}

function FileShield() {
  const [view, setView] = useState("blocked");
  const [blocked, setBlocked] = useState(null);
  const [recent, setRecent] = useState(null);
  const [bans, setBans] = useState(null);

  const load = useCallback(() => {
    api.get("/admin/files/blocked").then(({ data }) => setBlocked(data)).catch(() => setBlocked([]));
    api.get("/admin/files/recent").then(({ data }) => setRecent(data)).catch(() => setRecent([]));
    api.get("/admin/files/bans").then(({ data }) => setBans(data)).catch(() => setBans([]));
  }, []);
  useEffect(load, [load]);

  const ban = async (sha256, name) => {
    const reason = window.prompt(`Ban this exact file everywhere? Any future upload with the same fingerprint will be blocked, whatever it's named.\n\nReason (optional):`, name ? `Banned: ${name}` : "");
    if (reason === null) return;
    try {
      await api.post("/admin/files/bans", { sha256, reason });
      toast.ok("File banned");
      load();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  const unban = async (sha256) => {
    try {
      await api.delete(`/admin/files/bans/${sha256}`);
      toast.ok("Ban lifted");
      load();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };

  return (
    <div className="col gap-12">
      <Callout icon={ShieldCheck} tone="ok" title="How File Shield works">
        Every upload is read byte-by-byte before it's accepted. It blocks programs disguised as documents, hidden right-to-left filename
        tricks, files whose content doesn't match their extension, executables inside zip archives, and anything an admin has banned. Every
        accepted file is fingerprinted (SHA-256) and re-checked on download. Optional: connect a ClamAV scanner with <code>CLAMAV_HOST</code>.
      </Callout>
      <Segmented
        label="File Shield view"
        value={view}
        onChange={setView}
        options={[
          { value: "blocked", label: "Blocked", count: blocked?.length },
          { value: "recent", label: "Accepted files", count: recent?.length },
          { value: "bans", label: "Banned fingerprints", count: bans?.length },
        ]}
      />
      <div className="panel">
        {view === "blocked" && (
          !blocked ? <div className="panel-body"><Skeleton h={18} /></div> : blocked.length === 0 ? (
            <Empty icon={<ShieldCheck />} title="Nothing blocked yet">When someone tries to upload a dangerous file, it's stopped and listed here.</Empty>
          ) : (
            <div className="panel-list">
              {blocked.map((b) => (
                <div key={b.id} className="panel-body col gap-8">
                  <div className="row between wrap">
                    <span className="row"><ShieldX size={16} color="var(--breach)" /><b className="ellipsis" style={{ maxWidth: 360 }}>{b.original_name}</b><span className="small muted">{bytes(Number(b.size_bytes))}</span></span>
                    <span className="small muted">{b.user_name || "Deleted user"} · {b.context} · {timeAgo(b.created_at)}</span>
                  </div>
                  <ul className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--breach)" }}>{b.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  <div className="row between wrap">
                    {b.sha256 && <Fingerprint hash={b.sha256} />}
                    {b.sha256 && !b.banned && <Button size="sm" icon={<Ban />} onClick={() => ban(b.sha256, b.original_name)}>Ban this fingerprint</Button>}
                    {b.banned && <span className="pill bad">Banned</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {view === "recent" && (
          !recent ? <div className="panel-body"><Skeleton h={18} /></div> : recent.length === 0 ? <Empty title="No files yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>File</th><th>From</th><th>Check</th><th>Fingerprint</th><th /></tr></thead>
                <tbody>
                  {recent.map((f) => (
                    <tr key={f.id}>
                      <td><div className="ellipsis" style={{ maxWidth: 260, fontWeight: 600 }}>{f.name}</div><div className="tiny muted">{bytes(f.size)} · {timeAgo(f.created_at)}</div></td>
                      <td className="small">{f.uploaded_by_name || "—"}</td>
                      <td>{f.risk_level === "warn" ? <span className="pill warn" title={f.risk_notes.join("\n")}>Warning</span> : <span className="pill ok">Clean</span>}</td>
                      <td><Fingerprint hash={f.sha256} /></td>
                      <td>{f.banned ? <span className="pill bad">Banned</span> : <Button size="sm" variant="ghost" icon={<Ban />} onClick={() => ban(f.sha256, f.name)} aria-label={`Ban ${f.name}`} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
        {view === "bans" && (
          !bans ? <div className="panel-body"><Skeleton h={18} /></div> : bans.length === 0 ? (
            <Empty icon={<Ban />} title="No banned files">Ban a file's fingerprint to stop it from ever being uploaded again — even renamed.</Empty>
          ) : (
            <div className="panel-list">
              {bans.map((b) => (
                <div key={b.sha256} className="panel-body row between wrap">
                  <div className="col gap-4">
                    <Fingerprint hash={b.sha256} />
                    <span className="small muted">{b.reason || "No reason given"} · by {b.banned_by_name || "—"} {timeAgo(b.created_at)}</span>
                  </div>
                  <Button size="sm" onClick={() => unban(b.sha256)}>Lift ban</Button>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function AuditLog() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [chain, setChain] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      api.get("/admin/audit", { params: { q: q || undefined, page } }).then(({ data }) => setData(data)).catch(async (e) => toast.bad(await errorMessage(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, page]);

  const verify = async () => {
    setVerifying(true);
    try {
      const { data } = await api.post("/admin/audit/verify");
      setChain(data);
    } catch (err) {
      toast.bad(await errorMessage(err));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="col gap-12">
      <div className="panel panel-body col gap-12">
        <div className="row between wrap gap-12">
          <div className="col gap-4" style={{ maxWidth: "64ch" }}>
            <h3 className="h2 row"><Link2 size={16} /> Tamper-evident log</h3>
            <span className="small muted">
              Each entry is sealed with a hash of the one before it, so editing or deleting any past entry breaks the chain from that point on.
              The database also refuses edits and deletes outright.
            </span>
          </div>
          <Button variant="primary" loading={verifying} onClick={verify}>Verify integrity</Button>
        </div>
        {chain && (
          chain.ok ? (
            <Callout tone="ok" title={`Intact — all ${chain.checked} entries verified`}>
              <span className="small">Current head fingerprint (write it down somewhere outside Airlock to detect a full rewrite later):</span>
              <div className="mt-4"><Fingerprint hash={chain.head} short={false} /></div>
            </Callout>
          ) : (
            <Callout tone="bad" title={`Tampering detected at entry #${chain.brokenAt}`}>
              {chain.reason}. {chain.checked} entries before it are intact. Treat everything from #{chain.brokenAt} onward as untrusted and investigate database access.
            </Callout>
          )
        )}
      </div>
      <div className="search" style={{ width: "min(320px, 100%)" }}>
        <Search />
        <input className="input" placeholder="Search actions, people, details" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search audit log" />
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>When</th><th>What happened</th><th>IP</th><th>Seal</th></tr></thead>
            <tbody>
              {!data && <tr><td colSpan={5}><Skeleton h={18} /></td></tr>}
              {data?.items.map((e) => (
                <tr key={e.id} style={{ background: chain && !chain.ok && Number(e.id) >= Number(chain.brokenAt) ? "var(--breach-tint)" : undefined }}>
                  <td className="mono faint">{e.id}</td>
                  <td className="nowrap small" title={dateTime(e.created_at)}>{timeAgo(e.created_at)}</td>
                  <td style={{ color: isAlarming(e) ? "var(--breach)" : undefined }}>
                    {describe(e)}
                    {e.meta?.reasons && <div className="tiny muted">{e.meta.reasons[0]}</div>}
                    {e.meta?.note && <div className="tiny muted">“{e.meta.note}”</div>}
                  </td>
                  <td className="mono small">{e.ip_address || "—"}</td>
                  <td className="mono tiny faint" title={e.hash}>{e.hash.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pager page={page} hasMore={data.has_more} onPage={setPage} />}
      </div>
    </div>
  );
}

function Settings() {
  const [s, setS] = useState(null);
  const user = useAuth((st) => st.user);
  const refresh = useAuth((st) => st.refresh);
  useEffect(() => {
    api.get("/admin/settings").then(({ data }) => setS(data)).catch(() => {});
  }, []);
  const update = async (patch) => {
    try {
      const { data } = await api.patch("/admin/settings", patch);
      setS(data);
      refresh().catch(() => {});
      toast.ok("Setting saved");
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };
  if (!s) return <Skeleton h={120} />;
  return (
    <div className="panel panel-list" style={{ maxWidth: 760 }}>
      <div className="panel-body row top gap-16">
        <div className="grow col gap-4">
          <span className="h3">Require two-step sign-in for everyone</span>
          <span className="small muted">
            People without it are asked to set it up at their next sign-in and can't use Airlock until they do.
            {!user.totp_enabled && <b style={{ color: "var(--signal)" }}> Turn it on for your own account first.</b>}
          </span>
        </div>
        <Switch label="Require two-step sign-in" checked={!!s.enforce_2fa} onChange={(v) => update({ enforce_2fa: v })} />
      </div>
      <div className="panel-body row top gap-16">
        <div className="grow col gap-4">
          <span className="h3">Allow direct transfers</span>
          <span className="small muted">
            Lets people send a file browser-to-browser while both are online. Fast and private, but the file never reaches the server, so File
            Shield can't inspect it. Each transfer offer is still recorded in the audit log.
          </span>
        </div>
        <Switch label="Allow direct transfers" checked={!!s.allow_p2p} onChange={(v) => update({ allow_p2p: v })} />
      </div>
    </div>
  );
}

const TABS = [
  { value: "signins", label: "Sign-ins" },
  { value: "files", label: "File Shield" },
  { value: "audit", label: "Audit log" },
  { value: "settings", label: "Settings" },
];

export default function Security() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "signins";
  return (
    <div className="col gap-16">
      <Segmented label="Security section" value={tab} onChange={(v) => setParams({ tab: v })} options={TABS} />
      {tab === "signins" && <SignIns />}
      {tab === "files" && <FileShield />}
      {tab === "audit" && <AuditLog />}
      {tab === "settings" && <Settings />}
    </div>
  );
}
