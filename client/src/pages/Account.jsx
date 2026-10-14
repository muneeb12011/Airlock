import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, LogOut, MapPin } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { dateTime, timeAgo, userAgentLabel } from "../lib/format";
import { ChangePasswordForm, TwoFactorEnroll, RecoveryCodes } from "../components/SecurityForms";
import { Button, Callout, Field, Modal } from "../components/ui";

function ConfirmWithCode({ title, action, danger, onClose, onSubmit }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({ password, code });
    } catch (err) {
      setError(await errorMessage(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="col gap-16" onSubmit={submit}>
        <Field label="Your password" htmlFor="cc-pw">
          <input id="cc-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Code from your authenticator app" htmlFor="cc-code">
          <input id="cc-code" className="input mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
        </Field>
        {error && <Callout tone="bad">{error}</Callout>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger solid" : "primary"} loading={busy} disabled={code.length !== 6}>{action}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function SecuritySection() {
  const user = useAuth((s) => s.user);
  const refresh = useAuth((s) => s.refresh);
  const setSession = useAuth((s) => s.setSession);
  const logout = useAuth((s) => s.logout);
  const settings = useAuth((s) => s.settings);
  const [activity, setActivity] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [newCodes, setNewCodes] = useState(null);

  useEffect(() => {
    refresh().catch(() => {});
    api.get("/auth/activity").then(({ data }) => setActivity(data)).catch(() => {});
  }, [refresh]);

  const disable2fa = async (body) => {
    const { data } = await api.post("/auth/2fa/disable", body);
    setSession(data);
    setDialog(null);
    toast.ok("Two-step sign-in turned off");
  };
  const regenerate = async (body) => {
    const { data } = await api.post("/auth/2fa/recovery-codes", body);
    setDialog(null);
    setNewCodes(data.recovery_codes);
    refresh().catch(() => {});
  };
  const signOutEverywhere = async () => {
    if (!window.confirm("Sign out of Airlock on every device, including this one?")) return;
    try {
      await api.post("/auth/logout-all");
      logout();
    } catch (err) {
      toast.bad(await errorMessage(err));
    }
  };

  const failed = activity.filter((a) => !a.success).length;

  return (
    <div className="col gap-24" style={{ maxWidth: 860 }}>
      <section className="panel">
        <div className="panel-head">
          <div className="row">
            {user.totp_enabled ? <ShieldCheck size={18} color="var(--seal)" /> : <ShieldAlert size={18} color="var(--signal)" />}
            <h2 className="h2">Two-step sign-in</h2>
          </div>
          {user.totp_enabled ? <span className="pill ok">On</span> : <span className="pill warn">Off</span>}
        </div>
        <div className="panel-body col gap-12">
          {user.totp_enabled ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Signing in needs your password and a code from your authenticator app. You have{" "}
                <b style={{ color: user.recovery_codes_left <= 2 ? "var(--breach)" : "var(--ink)" }}>{user.recovery_codes_left}</b> unused recovery codes.
              </p>
              {newCodes ? (
                <RecoveryCodes codes={newCodes} onConfirm={() => setNewCodes(null)} />
              ) : (
                <div className="row wrap">
                  <Button onClick={() => setDialog("codes")}>Generate new recovery codes</Button>
                  {!settings.enforce_2fa && <Button variant="danger" onClick={() => setDialog("disable")}>Turn off</Button>}
                </div>
              )}
              {settings.enforce_2fa && <span className="small faint">Your admin requires two-step sign-in, so it can't be turned off.</span>}
            </>
          ) : enrolling ? (
            <TwoFactorEnroll onEnabled={() => { setEnrolling(false); refresh().catch(() => {}); }} />
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Protect your account even if your password leaks. Takes about a minute.</p>
              <div><Button variant="primary" onClick={() => setEnrolling(true)}>Set up two-step sign-in</Button></div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="h2">Password</h2></div>
        <div className="panel-body" style={{ maxWidth: 440 }}>
          <ChangePasswordForm onDone={() => toast.ok("Password updated. Other devices were signed out.")} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="h2">Recent sign-ins</h2>
            <div className="small muted">If you don't recognise one, change your password and sign out everywhere.</div>
          </div>
          <Button variant="danger" size="sm" icon={<LogOut />} onClick={signOutEverywhere}>Sign out everywhere</Button>
        </div>
        {failed > 0 && <div style={{ padding: "12px 18px 0" }}><Callout tone="warn">{failed} failed sign-in attempt{failed === 1 ? "" : "s"} in this list.</Callout></div>}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Result</th><th>Network</th><th>Device</th></tr></thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id}>
                  <td title={dateTime(a.login_at)}>{timeAgo(a.login_at)}</td>
                  <td>{a.success ? <span className="pill ok">Signed in</span> : <span className="pill bad">{a.reason === "locked" ? "Blocked (locked)" : "Failed"}</span>}</td>
                  <td>
                    <span className="mono">{a.ip_address}</span>
                    {a.new_ip && <span className="pill warn" style={{ marginLeft: 8 }}><MapPin size={12} /> New network</span>}
                  </td>
                  <td className="muted">{userAgentLabel(a.user_agent)}</td>
                </tr>
              ))}
              {activity.length === 0 && <tr><td colSpan={4} className="muted">No sign-ins recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {dialog === "disable" && <ConfirmWithCode title="Turn off two-step sign-in" action="Turn off" danger onClose={() => setDialog(null)} onSubmit={disable2fa} />}
      {dialog === "codes" && <ConfirmWithCode title="Generate new recovery codes" action="Generate" onClose={() => setDialog(null)} onSubmit={regenerate} />}
    </div>
  );
}
