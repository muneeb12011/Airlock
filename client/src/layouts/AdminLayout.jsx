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
    <div className="app-shell">
      <header className="app-header">
        <div className="app-eyebrow">
          <span className="live-dot" />
          AIRLOCK — ADMIN
        </div>
        <div className="header-right">
          <span className="user-tag">{currentUser?.name}</span>
          <button className="btn-ghost" type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <nav className="app-nav">
        <NavLink to="/admin/tasks" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Tasks
        </NavLink>
        <NavLink to="/admin/members" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Team
        </NavLink>
        <NavLink to="/admin/logs" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Login logs
        </NavLink>
        <NavLink to="/admin/messages" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Messages
        </NavLink>
      </nav>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
