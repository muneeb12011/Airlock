export const TYPES = ["feature", "bug", "docs", "research", "review", "design", "content", "campaign", "chore", "other"];
export const PRIORITIES = ["low", "medium", "high", "urgent"];
export const STATUSES = ["pending", "in_progress", "in_review", "completed"];

// Recognise common work links so they can be shown with the right label.
export function linkKind(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "github.com" && /\/pull\/\d+/.test(u.pathname)) return "github_pr";
    if (h === "github.com" && /\/issues\/\d+/.test(u.pathname)) return "github_issue";
    if (h === "github.com" && /\/commit\/[0-9a-f]{7,}/.test(u.pathname)) return "github_commit";
    if (h.endsWith("gitlab.com") && /merge_requests\/\d+/.test(u.pathname)) return "gitlab_mr";
    if (h.endsWith("figma.com")) return "figma";
    if (h === "docs.google.com") return "google_doc";
    if (h === "drive.google.com") return "google_drive";
    if (h.endsWith("notion.so") || h.endsWith("notion.site")) return "notion";
    if (h.endsWith("canva.com")) return "canva";
    if (h.endsWith("vercel.app") || h.endsWith("netlify.app")) return "preview";
    return "link";
  } catch {
    return "link";
  }
}

export const normalizeLabels = (labels = []) =>
  [...new Set(labels.map((l) => String(l).trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30)).filter(Boolean))].slice(0, 10);
