import { NavLink, Outlet, useNavigate } from "react-router-dom";
import useAuthStore from "../store/useAuthStore";

export default function AdminLayout() {
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
          TASK OPS &mdash; ADMIN
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userTag}>{currentUser?.name}</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <nav style={styles.nav}>
        <NavLink to="/admin/tasks" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Tasks
        </NavLink>
        <NavLink to="/admin/members" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Team Members
        </NavLink>
        <NavLink to="/admin/logs" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
          Login Logs
        </NavLink>
        <NavLink to="/admin/messages" style={({ isActive }) => (isActive ? styles.navActive : styles.navLink)}>
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
  headerRight: { display: "flex", alignItems: "center", gap: 14 },
  userTag: { fontSize: 13, color: "#8a8071" },
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
  main: { padding: 28, maxWidth: 1100, margin: "0 auto" },
};