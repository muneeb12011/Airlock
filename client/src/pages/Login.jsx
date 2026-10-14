import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import AirlockDoor from "../components/AirlockDoor";
import api from "../api";
import useAuth, { needsSetup } from "../store/auth";
import { BrandMark, useDocumentTitle } from "../components/Shell";
import { Button, Callout, Field } from "../components/ui";
import { errorMessage } from "../lib/download";

export function AuthLayout({ children, phase = "idle" }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <div className="auth-brand"><BrandMark /> Airlock</div>
        <AirlockDoor phase={phase} />
        <div className="auth-foot">
          <h2 className="claim">Nothing gets in or out unchecked.</h2>
          <p>Two-step sign-in, files checked for disguised programs, and an audit log that shows if anyone edits it.</p>
        </div>
      </section>
      <section className="auth-form">
        <div>{children}</div>
      </section>
    </div>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function Login() {
  const location0 = useLocation();
  const [email, setEmail] = useState(location0.state?.email || "");
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [config, setConfig] = useState({ workspace_name: "", email_enabled: false });
  useEffect(() => {
    api.get("/auth/config").then(({ data }) => setConfig(data)).catch(() => {});
  }, []);
  useDocumentTitle(forgot ? "Reset password" : "Sign in", config.workspace_name);
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();

  // Let the doors open before moving on (skipped with reduced motion).
  const finish = (data) => {
    setGranted(true);
    setTimeout(() => {
      setSession(data);
      useAuth.getState().refresh().catch(() => {});
      const dest = location.state?.from;
      if (needsSetup(data.user)) navigate("/setup", { replace: true });
      else navigate(dest && dest !== "/login" ? dest : "/home", { replace: true });
    }, reducedMotion() ? 0 : 1050);
  };
  const phase = granted ? "granted" : busy ? "verifying" : error ? "error" : mfaToken ? "mfa" : "idle";

  const submitPassword = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.mfa_required) {
        setMfaToken(data.mfa_token);
        setPassword("");
      } else finish(data);
    } catch (err) {
      setError(await errorMessage(err, "Sign-in failed."));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = useRecovery ? { mfa_token: mfaToken, recovery_code: code } : { mfa_token: mfaToken, code };
      const { data } = await api.post("/auth/login/verify", body);
      finish(data);
    } catch (err) {
      if (err.response?.data?.code === "MFA_EXPIRED") {
        setMfaToken(null);
        setCode("");
      }
      setError(await errorMessage(err, "That didn't work."));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(await errorMessage(err, "Couldn't send the link."));
    } finally {
      setBusy(false);
    }
  };

  if (forgot) {
    return (
      <AuthLayout>
        <div className="col gap-4">
          <h1 className="h1">Reset your password</h1>
          <p className="muted" style={{ margin: 0 }}>
            {config.email_enabled ? "We'll email you a link to choose a new one. It works once and expires in an hour." : "Email isn't set up for this workspace. Ask an admin to reset your password — they'll give you a one-time password."}
          </p>
        </div>
        {config.email_enabled && (sent ? (
          <Callout tone="ok" title="Check your email">If {email} has an account here, a reset link is on its way. Nothing arriving? Check spam, or ask an admin.</Callout>
        ) : (
          <form onSubmit={sendReset} className="col gap-16">
            <Field label="Work email" htmlFor="fg-email">
              <input id="fg-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            {error && <Callout tone="bad">{error}</Callout>}
            <Button type="submit" variant="primary" block loading={busy}>Email me a reset link</Button>
          </form>
        ))}
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => { setForgot(false); setSent(false); setError(""); }} style={{ alignSelf: "flex-start" }}>Back to sign in</Button>
      </AuthLayout>
    );
  }

  if (mfaToken) {
    return (
      <AuthLayout phase={phase}>
        <div className="col gap-4">
          <span className="small muted">Step 2 of 2</span>
          <h1 className="h1">Confirm it's you</h1>
          <p className="muted" style={{ margin: 0 }}>
            {useRecovery ? "Enter one of the recovery codes you saved when you set up two-step sign-in. Each code works once." : "Open your authenticator app and enter the 6-digit code for Airlock."}
          </p>
        </div>
        <form onSubmit={submitCode} className="col gap-16">
          {useRecovery ? (
            <Field label="Recovery code" htmlFor="rc">
              <input id="rc" className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abcd-efgh" autoComplete="off" autoFocus required />
            </Field>
          ) : (
            <input
              className="input code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
              autoFocus
              required
            />
          )}
          {error && <Callout tone="bad">{error}</Callout>}
          <Button type="submit" variant="primary" block loading={busy} disabled={!useRecovery && code.length !== 6}>Verify and sign in</Button>
        </form>
        <div className="row between">
          <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => { setMfaToken(null); setError(""); setCode(""); }}>Back</Button>
          <Button variant="ghost" size="sm" onClick={() => { setUseRecovery((v) => !v); setCode(""); setError(""); }}>
            {useRecovery ? "Use authenticator code" : "Lost your phone? Use a recovery code"}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout phase={phase}>
      <div className="col gap-4">
        <h1 className="h1">Sign in{config.workspace_name && config.workspace_name !== "Airlock" ? ` to ${config.workspace_name}` : ""}</h1>
        <p className="muted" style={{ margin: 0 }}>Accounts are created by your admin. Every sign-in is recorded with its network address.</p>
      </div>
      {location0.state?.notice && <Callout tone="ok">{location0.state.notice}</Callout>}
      <form onSubmit={submitPassword} className="col gap-16">
        <Field label="Work email" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} required />
        </Field>
        {error && <Callout tone="bad">{error}</Callout>}
        <Button type="submit" variant="primary" block loading={busy || granted}>{granted ? "Opening…" : "Sign in"}</Button>
      </form>
      <Button variant="ghost" size="sm" onClick={() => { setForgot(true); setError(""); }} style={{ alignSelf: "flex-start" }}>Forgot your password?</Button>
    </AuthLayout>
  );
}
