import { useEffect, useId, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ListChecks, Users, MessageSquare, ShieldCheck, Bell, LogOut, UserCog, Sun, Moon, Monitor,
  FolderKanban, BarChart3, Settings, Search, Menu,
} from "lucide-react";
import CommandPalette from "./CommandPalette";
import { ROLES } from "../lib/format";
import api from "../api";
import useAuth from "../store/auth";
import useLive from "../store/live";
import useWorkspace from "../store/workspace";
import { connectSocket, disconnectSocket } from "../socket";
import { toast } from "../store/toast";
import { Avatar, Button } from "./ui";
import { DirectTransferHost } from "./DirectTransfer";
import { timeAgo } from "../lib/format";

// The Airlock mark: an arched bulkhead door, sealed down the middle, with a
// green "cleared" light above it.
export function BrandMark({ className = "brand-mark" }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14806b" />
          <stop offset="1" stopColor="#0a4a3e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <path d="M14.5 53V30a17.5 17.5 0 0 1 35 0v23" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M21.5 53V35.5a9 9 0 0 1 8.5-8.99V53z" fill="#fff" />
      <path d="M42.5 53V35.5a9 9 0 0 0-8.5-8.99V53z" fill="#fff" />
      <circle cx="32" cy="19.2" r="2.9" fill="#6ee7c4" />
    </svg>
  );
}

// Keeps the browser tab title specific: "Tasks · Northwind Studio".
export function useDocumentTitle(title, workspace) {
  useEffect(() => {
    const ws = workspace && workspace !== "Airlock" ? `${workspace} · Airlock` : "Airlock";
    document.title = title ? `${title} · ${ws}` : ws;
  }, [title, workspace]);
}

// Connects the socket for the signed-in user and feeds the live store.
export function LiveBridge() {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const ready = Boolean(token && user && !user.must_change_password && !user.must_enroll_2fa);

  useEffect(() => {
    if (!ready) {
      disconnectSocket();
      useLive.getState().reset();
      useWorkspace.getState().reset();
      return undefined;
    }
    const live = useLive.getState();
    const socket = connectSocket(token);
    if (!socket) return undefined;

    const loadCounts = () => {
      api.get("/notifications").then(({ data }) => live.setNotifications(data.items, data.unread)).catch(() => {});
      api.get("/messages/unread-count").then(({ data }) => live.setUnreadMessages(data.count)).catch(() => {});
    };
    loadCounts();

    const on = {
      connect: () => { live.setConnected(true); loadCounts(); },
      disconnect: () => live.setConnected(false),
      connect_error: (e) => { if (e.message === "unauthorized") useAuth.getState().refresh().catch(() => {}); },
      "presence:update": ({ onlineUserIds }) => live.setOnline(onlineUserIds),
      "notification:new": (n) => {
        live.pushNotification(n);
        if (n.type === "security") toast.bad(n.title);
        else toast.info(n.title);
      },
      "task:changed": () => live.bumpTasks(),
      "message:new": (m) => {
        live.receiveMessage(m);
        if (m.sender_id !== useAuth.getState().user?.id) {
          const inThread = window.location.pathname === "/messages" && new URLSearchParams(window.location.search).get("with") === String(m.sender_id);
          if (!inThread) {
            useLive.getState().setUnreadMessages(useLive.getState().unreadMessages + 1);
            toast.info(`${m.sender_name}: ${m.message || m.file?.name || "sent a file"}`);
          }
        }
      },
      "message:read": (r) => live.receiveRead(r),
      typing: ({ from }) => live.setTyping(from),
    };
    for (const [ev, fn] of Object.entries(on)) socket.on(ev, fn);
    return () => {
      for (const [ev, fn] of Object.entries(on)) socket.off(ev, fn);
    };
  }, [ready, token]);

  return null;
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("airlock-theme") || "system"; } catch { return "system"; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      theme === "system" ? localStorage.removeItem("airlock-theme") : localStorage.setItem("airlock-theme", theme);
    } catch { /* ignore */ }
  }, [theme]);
  const next = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return [theme, next];
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const items = useLive((s) => s.notifications);
  const unread = useLive((s) => s.unreadNotifications);
  const markAllRead = useLive((s) => s.markAllRead);
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const k = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);

  const readAll = () => {
    markAllRead();
    api.post("/notifications/read", {}).catch(() => {});
  };

  const go = (n) => {
    if (!n.read_at) api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <Button variant="ghost" icon={<Bell />} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {unread > 0 && <span className="badge-dot" aria-hidden>{unread > 9 ? "9+" : unread}</span>}
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="row between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-soft)" }}>
            <span className="h3">Notifications</span>
            {unread > 0 && <Button size="sm" variant="ghost" onClick={readAll}>Mark all read</Button>}
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {items.length === 0 && <div className="empty small">You're all caught up.</div>}
            {items.map((n) => (
              <button key={n.id} type="button" className={`notif ${n.read_at ? "read" : "unread"}`} onClick={() => go(n)}>
                <span className="dot" />
                <span className="col gap-4 grow" style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: n.type === "security" ? "var(--breach)" : undefined }}>{n.title}</span>
                  {n.body && <span className="small muted">{n.body}</span>}
                  <span className="tiny faint">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: "/home", label: "Home", icon: LayoutDashboard, roles: ["admin", "manager", "member"] },
  { to: "/tasks", label: "Tasks", icon: ListChecks, roles: ["admin", "manager", "member"] },
  { to: "/projects", label: "Projects", icon: FolderKanban, roles: ["admin", "manager", "member"] },
  { to: "/messages", label: "Messages", icon: MessageSquare, badge: "messages", roles: ["admin", "manager", "member"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin", "manager"] },
  { to: "/people", label: "People", icon: Users, roles: ["admin", "manager", "member"] },
  { to: "/admin/security", label: "Security", icon: ShieldCheck, roles: ["admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];
const MOBILE_PRIMARY = ["/home", "/tasks", "/projects", "/messages"];
const TITLES = { "/profile": "Profile" };

export function AppShell() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const workspace = useAuth((s) => s.settings.workspace_name);
  const unreadMessages = useLive((s) => s.unreadMessages);
  const connected = useLive((s) => s.connected);
  const [theme, cycleTheme] = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const location = useLocation();
  const nav = NAV.filter((n) => n.roles.includes(user?.role));

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 4);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => setMenu(false), [location.pathname]);

  const current = [...nav].sort((a, b) => b.to.length - a.to.length).find((n) => location.pathname.startsWith(n.to));
  const title = TITLES[location.pathname] || current?.label || "";
  useDocumentTitle(title, workspace);

  const link = (n, compact) => (
    <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
      <n.icon size={compact ? 20 : 18} aria-hidden />
      <span>{n.label}</span>
      {n.badge === "messages" && unreadMessages > 0 && <span className="count">{unreadMessages}</span>}
    </NavLink>
  );

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/home" className="brand">
          <BrandMark />
          <span className="ellipsis">{workspace || "Airlock"}</span>
        </NavLink>
        <button type="button" className="search-trigger" style={{ margin: "0 0 10px" }} onClick={() => setPalette(true)}>
          <Search size={15} /> <span className="grow" style={{ textAlign: "left" }}>Search</span> <span className="kbd">{isMac ? "⌘" : "Ctrl"} K</span>
        </button>
        <nav className="col gap-4" aria-label="Main">{nav.map((n) => link(n))}</nav>
        <div className="sidebar-foot">
          <button type="button" className="nav-link" style={{ border: 0, background: "transparent", cursor: "pointer" }} onClick={cycleTheme}>
            <ThemeIcon size={18} aria-hidden /> Theme: {theme}
          </button>
          <button type="button" className="nav-link" style={{ border: 0, background: "transparent", cursor: "pointer" }} onClick={logout}>
            <LogOut size={18} aria-hidden /> Sign out
          </button>
          <NavLink to="/profile" className={({ isActive }) => `me nav-link${isActive ? " active" : ""}`} style={{ padding: "8px 10px" }}>
            <Avatar name={user?.name} id={user?.id} src={user?.avatar_url} />
            <div className="col" style={{ minWidth: 0, gap: 0 }}>
              <span className="ellipsis" style={{ fontWeight: 600, color: "var(--ink)" }}>{user?.name}</span>
              <span className="tiny faint">{user?.title || ROLES[user?.role]}</span>
            </div>
          </NavLink>
        </div>
      </aside>

      <div className="main">
        <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
          <BrandMark className="brand-mark mobile-only" />
          <h1 className="h1 grow ellipsis">{title}</h1>
          {!connected && <span className="pill warn" title="Live updates paused — reconnecting">Reconnecting</span>}
          <Button variant="ghost" className="mobile-only" icon={<Search />} aria-label="Search" onClick={() => setPalette(true)} />
          <NotificationBell />
          <div className="mobile-only" style={{ position: "relative" }}>
            <Button variant="ghost" icon={<Menu />} aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} />
            {menu && (
              <div className="popover" style={{ width: 240, padding: 6 }} role="menu">
                {nav.filter((n) => !MOBILE_PRIMARY.includes(n.to)).map((n) => link(n))}
                {link({ to: "/profile", label: "Profile", icon: UserCog })}
                <button type="button" className="nav-link" style={{ border: 0, background: "transparent", width: "100%", cursor: "pointer" }} onClick={cycleTheme}><ThemeIcon size={18} /> Theme: {theme}</button>
                <button type="button" className="nav-link" style={{ border: 0, background: "transparent", width: "100%", cursor: "pointer" }} onClick={logout}><LogOut size={18} /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>

      <DirectTransferHost />
      {palette && <CommandPalette onClose={() => setPalette(false)} nav={nav} />}
      <nav className="tabbar" aria-label="Main">
        {nav.filter((n) => MOBILE_PRIMARY.includes(n.to)).map((n) => link(n, true))}
        {link({ to: "/profile", label: "Profile", icon: UserCog }, true)}
      </nav>
    </div>
  );
}
