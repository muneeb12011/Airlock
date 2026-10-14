import { Component, lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import useAuth, { needsSetup } from "./store/auth";
import { isApiConfigured } from "./lib/config";
import { AppShell, LiveBridge, BrandMark } from "./components/Shell";
import { Toasts } from "./components/ui";
import Login from "./pages/Login";
import Setup from "./pages/Setup";

const Overview = lazy(() => import("./pages/admin/Overview"));
const Security = lazy(() => import("./pages/admin/Security"));
const Work = lazy(() => import("./pages/member/Work"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Projects = lazy(() => import("./pages/Projects"));
const Project = lazy(() => import("./pages/Project"));
const Reports = lazy(() => import("./pages/Reports"));
const People = lazy(() => import("./pages/People"));
const Settings = lazy(() => import("./pages/Settings"));
const Messages = lazy(() => import("./pages/Messages"));
const Profile = lazy(() => import("./pages/Profile"));
const Reset = lazy(() => import("./pages/Reset"));

const home = () => "/home";
const lead = (u) => u?.role === "admin" || u?.role === "manager";

function Splash({ text = "Opening Airlock…" }) {
  return (
    <div className="setup-screen">
      <div className="col" style={{ alignItems: "center", gap: 14 }}>
        <BrandMark className="brand-mark" />
        <span className="muted small">{text}</span>
      </div>
    </div>
  );
}

function Protected({ role, children }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "booting") return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (needsSetup(user)) return <Navigate to="/setup" replace />;
  if (role && !(Array.isArray(role) ? role : [role]).includes(user.role)) return <Navigate to={home(user)} replace />;
  return children;
}

function Guest({ children }) {
  const { user, status } = useAuth();
  if (status === "booting") return <Splash />;
  if (user) return <Navigate to={needsSetup(user) ? "/setup" : home(user)} replace />;
  return children;
}

function SetupGate() {
  const { user, status } = useAuth();
  if (status === "booting") return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (!needsSetup(user)) return <Navigate to={home(user)} replace />;
  return <Setup />;
}

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="setup-screen">
        <div className="panel panel-body col" style={{ maxWidth: 440 }}>
          <h1 className="h2">This screen hit an error</h1>
          <p className="muted small">Reloading usually fixes it. If it keeps happening, tell your admin what you were doing.</p>
          <div className="row">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

function MissingApi() {
  return (
    <div className="setup-screen">
      <div className="panel panel-body col" style={{ maxWidth: 520 }}>
        <BrandMark />
        <h1 className="h2">The app is deployed, but it doesn't know where the API is</h1>
        <p className="muted">
          Set <code>VITE_API_URL</code> to your backend's address (for example <code>https://airlock-api.onrender.com</code>) in your
          hosting provider's environment settings, then rebuild. Vite bakes this value in at build time.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const boot = useAuth((s) => s.boot);
  useEffect(() => {
    boot();
  }, [boot]);

  if (!isApiConfigured) return <MissingApi />;

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <LiveBridge />
        <Suspense fallback={<Splash text="Loading…" />}>
          <Routes>
            <Route path="/login" element={<Guest><Login /></Guest>} />
            <Route path="/setup" element={<SetupGate />} />
            <Route path="/reset" element={<Reset />} />
            <Route element={<Protected><AppShell /></Protected>}>
              <Route path="/home" element={<Home />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:id" element={<Project />} />
              <Route path="/messages" element={<Messages />} />
              <Route path="/reports" element={<Protected role={["admin", "manager"]}><Reports /></Protected>} />
              <Route path="/people" element={<People />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/admin/security" element={<Protected role="admin"><Security /></Protected>} />
              <Route path="/settings" element={<Protected role="admin"><Settings /></Protected>} />
              {/* Old addresses from v1/v2 links and notifications */}
              <Route path="/admin" element={<Navigate to="/home" replace />} />
              <Route path="/admin/tasks" element={<KeepQuery to="/tasks" />} />
              <Route path="/admin/team" element={<Navigate to="/people?tab=accounts" replace />} />
              <Route path="/work" element={<KeepQuery to="/home" />} />
              <Route path="/account" element={<Navigate to="/profile?tab=security" replace />} />
            </Route>
            <Route path="*" element={<Protected><RoleHome /></Protected>} />
          </Routes>
        </Suspense>
        <Toasts />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function Home() {
  const user = useAuth((s) => s.user);
  return lead(user) ? <Overview /> : <Work />;
}

function KeepQuery({ to }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function RoleHome() {
  const user = useAuth((s) => s.user);
  return <Navigate to={home(user)} replace />;
}
