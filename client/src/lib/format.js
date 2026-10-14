const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function timeAgo(value) {
  if (!value) return "";
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: abs > 86400 * 300 ? "numeric" : undefined });
}

export const dateTime = (v) =>
  v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

export const clock = (v) => new Date(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function dayLabel(v) {
  const d = new Date(v);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

// "YYYY-MM-DD" → days from today (negative = past), in local time.
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

export function dueLabel(dateStr, status) {
  const n = daysUntil(dateStr);
  if (n === null) return null;
  if (status === "completed") return { text: `Due ${shortDate(dateStr)}`, tone: "" };
  if (n < 0) return { text: n === -1 ? "1 day overdue" : `${-n} days overdue`, tone: "overdue" };
  if (n === 0) return { text: "Due today", tone: "soon" };
  if (n === 1) return { text: "Due tomorrow", tone: "soon" };
  if (n <= 3) return { text: `Due in ${n} days`, tone: "soon" };
  return { text: `Due ${shortDate(dateStr)}`, tone: "" };
}

export function shortDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function bytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const STATUS = {
  pending: "To do",
  in_progress: "In progress",
  in_review: "In review",
  completed: "Done",
};

export const TYPES = {
  feature: "Feature",
  bug: "Bug fix",
  docs: "Docs",
  research: "Research",
  review: "Review",
  design: "Design",
  content: "Content",
  campaign: "Campaign",
  chore: "Chore",
  other: "Other",
};

export const KINDS = {
  general: "General",
  marketing: "Marketing",
  engineering: "Engineering",
  design: "Design",
  ops: "Operations",
  sales: "Sales",
};

export const ROLES = { admin: "Admin", manager: "Manager", member: "Team member" };

export const isLead = (u) => u?.role === "admin" || u?.role === "manager";

export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const PRIORITIES = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };

export function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || "")).toUpperCase();
}

const AVATAR_HUES = [168, 205, 232, 260, 290, 330, 20, 38, 140, 190];
export function avatarColor(seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 42% 38%)`;
}

export function userAgentLabel(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|python|axios|Go-http/i.test(ua) ? "Script" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
export const isAdmin = (u) => u?.role === "admin";
