import { NavLink, Outlet, useNavigate } from "react-router-dom";
import useAuthStore from "../store/useAuthStore";

export default function MemberLayout() {
  const logout = useAuthStore((s) => s.logout);
  const currentUser = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div style={styles.wrap}>
      <header style={styles.header}>
        <div style={styles.eyebrow}>
          <span style={styles.dot} />
          TASK OPS &mdash; {currentUser?.name?.toUpperCase()}
        </div>
        <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
      </header>

      <nav style={styles.nav}>
        <NavLink to="/dashboard/pending" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Pending
        </NavLink>
        <NavLink to="/dashboard/in-progress" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          In Progress
        </NavLink>
        <NavLink to="/dashboard/completed" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Completed
        </NavLink>
        <NavLink to="/dashboard/messages" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Messages
        </NavLink>
      </nav>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles = {
  wrap: {
    background: "#0b0a08",
    minHeight: "100vh",
    color: "#ece6da",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 28px",
    borderBottom: "1px solid #221d16",
  },
  eyebrow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    letterSpacing: "0.14em",
    color: "#a8895a",
  },
  dot: { width: 6, height: 6, borderRadius: "50%", background: "#c98a3e", display: "inline-block" },
  logoutBtn: {
    background: "transparent",
    border: "1px solid #2f2820",
    color: "#ece6da",
    padding: "7px 14px",
    borderRadius: 3,
    cursor: "pointer",
    fontSize: 13,
  },
  nav: { display: "flex", gap: 4, padding: "0 28px", borderBottom: "1px solid #221d16" },
  navLink: { padding: "12px 18px", fontSize: 13.5, color: "#79705f", textDecoration: "none", borderBottom: "2px solid transparent" },
  navActive: {
    padding: "12px 18px",
    fontSize: 13.5,
    color: "#f0e9dc",
    textDecoration: "none",
    borderBottom: "2px solid #c98a3e",
    fontWeight: 600,
  },
  main: { padding: 28, maxWidth: 900, margin: "0 auto" },
};