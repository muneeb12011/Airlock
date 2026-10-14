import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../api";
import { errorMessage } from "../lib/download";
import { AuthLayout } from "./Login";
import { Button, Callout, Field } from "../components/ui";

// Landing page for emailed invite and password-reset links.
export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/token-info", { params: { token } }).then(({ data }) => setInfo(data)).catch(async (err) => setError(await errorMessage(err, "This link is invalid or has expired.")));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/reset", { token, password: pw });
      navigate("/login", { replace: true, state: { email: data.email, notice: info.purpose === "invite" ? "Your account is ready. Sign in with your new password." : "Password changed. Sign in with your new password." } });
    } catch (err) {
      setError(await errorMessage(err, "Couldn't set your password."));
      setBusy(false);
    }
  };

  const invite = info?.purpose === "invite";
  return (
    <AuthLayout>
      <div className="col gap-4">
        <h1 className="h1">{invite ? `Welcome, ${info.name.split(" ")[0]}` : "Choose a new password"}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {info ? (invite ? `Set a password for ${info.email} to activate your account.` : `For ${info.email}. Every other device will be signed out.`) : "Checking your link…"}
        </p>
      </div>
      {info && (
        <form className="col gap-16" onSubmit={submit}>
          <Field label="New password" hint="At least 10 characters. Checked against known data breaches." htmlFor="rs-pw">
            <input id="rs-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} autoFocus />
          </Field>
          <Field label="Confirm password" htmlFor="rs-confirm">
            <input id="rs-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {error && <Callout tone="bad">{error}</Callout>}
          <Button type="submit" variant="primary" block loading={busy}>{invite ? "Activate my account" : "Save new password"}</Button>
        </form>
      )}
      {!info && error && <Callout tone="bad">{error} <Link to="/login">Back to sign in</Link></Callout>}
    </AuthLayout>
  );
}
