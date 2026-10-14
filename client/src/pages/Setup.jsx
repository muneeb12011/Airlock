import useAuth from "../store/auth";
import { AuthLayout } from "./Login";
import { ChangePasswordForm, TwoFactorEnroll } from "../components/SecurityForms";
import { Button } from "../components/ui";
import { toast } from "../store/toast";

// Shown after sign-in when the account still has a one-time password, or
// when the admin requires two-step sign-in and it isn't set up yet.
export default function Setup() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const settings = useAuth((s) => s.settings);
  const step = user.must_change_password ? 1 : 2;
  const total = user.must_change_password && (user.must_enroll_2fa || settings.enforce_2fa) && !user.totp_enabled ? 2 : 1;

  return (
    <AuthLayout>
      <div className="col gap-4">
        {total > 1 && <span className="small muted">Step {step} of {total}</span>}
        <h1 className="h1">{step === 1 ? `Welcome, ${user.name.split(" ")[0]}` : "Set up two-step sign-in"}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {step === 1
            ? "You signed in with a one-time password from your admin. Choose your own password to continue — only you will know it."
            : "Your admin requires a code from your phone at every sign-in. It takes about a minute."}
        </p>
      </div>
      {step === 1 ? (
        <ChangePasswordForm
          submitLabel="Save password and continue"
          currentHint="The one-time password your admin gave you."
          onDone={(data) => {
            if (!data.user.must_enroll_2fa) toast.ok("Password saved. You can turn on two-step sign-in from Account.");
          }}
        />
      ) : (
        <TwoFactorEnroll />
      )}
      <Button variant="ghost" size="sm" onClick={logout} style={{ alignSelf: "flex-start" }}>Sign out</Button>
    </AuthLayout>
  );
}
