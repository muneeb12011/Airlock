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
    <div className="app-shell">
      <header className="app-header">
        <div className="app-eyebrow">
          <span className="live-dot" />
          AIRLOCK — {currentUser?.name?.toUpperCase()}
        </div>
        <button className="btn-ghost" type="button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <nav className="app-nav">
        <NavLink to="/dashboard/pending" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Pending
        </NavLink>
        <NavLink to="/dashboard/in-progress" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          In progress
        </NavLink>
        <NavLink to="/dashboard/completed" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Completed
        </NavLink>
        <NavLink to="/dashboard/messages" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
          Messages
        </NavLink>
      </nav>

      <main className="app-main narrow">
        <Outlet />
      </main>
    </div>
  );
}
