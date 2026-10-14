import { useState } from "react";
import { Smartphone, Copy, Download } from "lucide-react";
import api from "../api";
import useAuth from "../store/auth";
import { toast } from "../store/toast";
import { errorMessage } from "../lib/download";
import { Button, Callout, Field } from "./ui";

function strength(pw) {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length < 10) s = Math.min(s, 1);
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong", "Strong"];
  return { score: s, label: labels[s] };
}

export function ChangePasswordForm({ onDone, submitLabel = "Update password", requireCurrent = true, currentHint }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const st = strength(next);
  const colors = ["var(--breach)", "var(--breach)", "var(--signal)", "var(--seal)", "var(--seal)", "var(--seal)"];

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (next !== confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/password", { current_password: current, new_password: next });
      setSession(data);
      setCurrent(""); setNext(""); setConfirm("");
      onDone?.(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't change your password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="col gap-16" onSubmit={submit}>
      {requireCurrent && (
        <Field label="Current password" hint={currentHint} htmlFor="pw-cur">
          <input id="pw-cur" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
      )}
      <Field label="New password" hint="At least 10 characters. A short sentence is easier to remember and harder to guess." htmlFor="pw-new">
        <input id="pw-new" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
      </Field>
      {next && (
        <div className="col gap-4" aria-live="polite">
          <div className="meter">
            <i style={{ width: `${(st.score / 5) * 100}%`, background: colors[st.score] }} />
          </div>
          <span className="tiny muted">{st.label}. We also check it against passwords leaked in known data breaches.</span>
        </div>
      )}
      <Field label="Confirm new password" htmlFor="pw-confirm">
        <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      {error && <Callout tone="bad">{error}</Callout>}
      <div><Button type="submit" variant="primary" loading={busy}>{submitLabel}</Button></div>
    </form>
  );
}

export function RecoveryCodes({ codes, onConfirm }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");
  const copy = () => navigator.clipboard?.writeText(text).then(() => toast.ok("Recovery codes copied"));
  const save = () => {
    const blob = new Blob([`Airlock recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "airlock-recovery-codes.txt";
    a.click();
  };
  return (
    <div className="col gap-12">
      <Callout tone="warn" title="Save these recovery codes now">
        If you lose your phone, one of these gets you back in. This is the only time they're shown.
      </Callout>
      <div className="recovery-grid">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <div className="row wrap">
        <Button size="sm" icon={<Copy />} onClick={copy}>Copy</Button>
        <Button size="sm" icon={<Download />} onClick={save}>Download .txt</Button>
      </div>
      {onConfirm && (
        <>
          <label className="row small" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my recovery codes somewhere safe
          </label>
          <div><Button variant="primary" disabled={!saved} onClick={onConfirm}>Done</Button></div>
        </>
      )}
    </div>
  );
}

export function TwoFactorEnroll({ onEnabled }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const setSession = useAuth((s) => s.setSession);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/2fa/setup");
      setSetup(data);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't start setup."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/2fa/enable", { code });
      // The server rotated our session; store the new token right away so
      // nothing in the background gets signed out, but keep the user object
      // as-is until the recovery codes have been acknowledged.
      setSession({ token: data.token });
      setCodes({ list: data.recovery_codes, session: data });
    } catch (err) {
      setError(await errorMessage(err, "That code didn't match."));
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes.list}
        onConfirm={() => {
          setSession(codes.session);
          toast.ok("Two-step sign-in is on");
          onEnabled?.(codes.session);
        }}
      />
    );
  }

  if (!setup) {
    return (
      <div className="col gap-12">
        <p className="muted" style={{ margin: 0, maxWidth: "60ch" }}>
          Stolen and reused passwords are the most common way accounts get taken over. With two-step sign-in, a password alone
          isn't enough — you'll also need a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft
          Authenticator, 1Password, Authy…).
        </p>
        {error && <Callout tone="bad">{error}</Callout>}
        <div><Button variant="primary" icon={<Smartphone />} loading={busy} onClick={start}>Set up two-step sign-in</Button></div>
      </div>
    );
  }

  return (
    <form className="col gap-16" onSubmit={verify}>
      <div className="row top gap-16 wrap">
        <img src={setup.qr} alt="QR code to add Airlock to your authenticator app" width={180} height={180} style={{ borderRadius: 8, background: "#fff", padding: 6, border: "1px solid var(--line)" }} />
        <ol className="small" style={{ margin: 0, paddingLeft: 18, maxWidth: "36ch", display: "flex", flexDirection: "column", gap: 8 }}>
          <li>Open your authenticator app and add an account.</li>
          <li>Scan this QR code with it.</li>
          <li>Enter the 6-digit code the app shows.</li>
          <li>
            Can't scan?{" "}
            <button type="button" className="btn ghost sm" style={{ padding: 0, height: "auto" }} onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide setup key" : "Type the key instead"}
            </button>
            {showKey && <div className="mono small mt-4" style={{ wordBreak: "break-all" }}>{setup.secret.match(/.{1,4}/g).join(" ")}</div>}
          </li>
        </ol>
      </div>
      <Field label="6-digit code" htmlFor="totp">
        <input id="totp" className="input code" style={{ maxWidth: 240 }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
      </Field>
      {error && <Callout tone="bad">{error}</Callout>}
      <div><Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>Turn on two-step sign-in</Button></div>
    </form>
  );
}
