import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import useAuthStore from "../store/useAuthStore";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      login(data.user, data.token);
      navigate(data.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <style>{css}</style>

      <div style={styles.frame}>
        <span style={{ ...styles.corner, ...styles.cornerTL }} />
        <span style={{ ...styles.corner, ...styles.cornerTR }} />
        <span style={{ ...styles.corner, ...styles.cornerBL }} />
        <span style={{ ...styles.corner, ...styles.cornerBR }} />

        <div style={styles.card}>
          <div style={styles.eyebrow}>
            <span style={styles.dot} />
            TASK OPS &mdash; ACCESS
          </div>

          <h1 style={styles.title}>Sign in</h1>
          <p style={styles.subtitle}>Authorized personnel only.</p>

          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label} htmlFor="email">Email</label>
            <input
              id="email"
              className="tm-input"
              style={styles.input}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <label style={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              className="tm-input"
              style={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            {error && (
              <p style={styles.error}>
                <span style={styles.errorMark}>!</span> {error}
              </p>
            )}

            <button className="tm-button" style={styles.button} type="submit" disabled={loading}>
              {loading ? "Verifying…" : "Log in"}
            </button>
          </form>

          <div style={styles.footer}>
            <span style={styles.liveDot} />
            Connection encrypted &middot; logins are recorded
          </div>
        </div>
      </div>
    </div>
  );
}

const css = `
  .tm-input {
    transition: border-color 120ms ease, background 120ms ease;
  }
  .tm-input:focus {
    outline: none;
    border-color: #c98a3e !important;
    background: #14110c !important;
  }
  .tm-button {
    transition: transform 100ms ease, background 120ms ease, box-shadow 120ms ease;
  }
  .tm-button:hover:not(:disabled) {
    background: #d99a4d !important;
    box-shadow: 0 0 0 1px rgba(201,138,62,0.4), 0 8px 24px rgba(201,138,62,0.15);
  }
  .tm-button:active:not(:disabled) {
    transform: translateY(1px);
  }
  .tm-button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  @keyframes tm-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
`;

const styles = {
  wrap: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh",
    background:
      "radial-gradient(ellipse at top, #17140f 0%, #0b0a08 60%)",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  frame: {
    position: "relative",
    padding: 22,
  },
  corner: {
    position: "absolute",
    width: 18,
    height: 18,
    borderColor: "#4a3d28",
  },
  cornerTL: { top: 0, left: 0, borderTop: "1px solid #4a3d28", borderLeft: "1px solid #4a3d28" },
  cornerTR: { top: 0, right: 0, borderTop: "1px solid #4a3d28", borderRight: "1px solid #4a3d28" },
  cornerBL: { bottom: 0, left: 0, borderBottom: "1px solid #4a3d28", borderLeft: "1px solid #4a3d28" },
  cornerBR: { bottom: 0, right: 0, borderBottom: "1px solid #4a3d28", borderRight: "1px solid #4a3d28" },
  card: {
    width: 360,
    background: "#161310",
    border: "1px solid #2a241c",
    borderRadius: 4,
    padding: "32px 30px 24px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "#a8895a",
    marginBottom: 18,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#c98a3e",
    display: "inline-block",
  },
  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 600,
    color: "#f0e9dc",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    margin: "6px 0 24px",
    fontSize: 13.5,
    color: "#79705f",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#8a8071",
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    padding: "11px 12px",
    borderRadius: 3,
    border: "1px solid #2f2820",
    background: "#100e0b",
    color: "#ece6da",
    fontSize: 14.5,
  },
  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "14px 0 0",
    fontSize: 13,
    color: "#e0836b",
  },
  errorMark: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 15,
    height: 15,
    borderRadius: "50%",
    border: "1px solid #e0836b",
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
  },
  button: {
    marginTop: 22,
    padding: "12px 12px",
    borderRadius: 3,
    border: "none",
    background: "#c98a3e",
    color: "#171310",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginTop: 22,
    paddingTop: 16,
    borderTop: "1px solid #221d16",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 10.5,
    letterSpacing: "0.02em",
    color: "#5c5344",
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "#5fa876",
    display: "inline-block",
    animation: "tm-pulse 2s ease-in-out infinite",
  },
};