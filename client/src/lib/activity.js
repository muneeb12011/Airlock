// Turns audit-log entries into plain sentences.
const host = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "a page";
  }
};
const t = (m) => (m?.title ? `“${m.title}”` : "a task");

export function describe(e) {
  const who = e.actor_name || "System";
  const m = e.meta || {};
  switch (e.action) {
    case "auth.login": return `${who} signed in${m.new_ip ? " from a new network" : ""}`;
    case "auth.account_locked": return `${who}'s account was locked after repeated failed sign-ins`;
    case "auth.password_changed": return `${who} changed their password`;
    case "auth.logout_all": return `${who} signed out everywhere`;
    case "auth.2fa_enabled": return `${who} turned on two-step sign-in`;
    case "auth.2fa_disabled": return `${who} turned off two-step sign-in`;
    case "auth.recovery_code_used": return `${who} signed in with a recovery code`;
    case "auth.recovery_codes_regenerated": return `${who} generated new recovery codes`;
    case "user.created": return `${who} ${m.invited ? "invited" : "added"} ${m.email || "a user"}${m.role && m.role !== "member" ? ` as ${m.role === "admin" ? "an admin" : "a manager"}` : ""}`;
    case "user.updated": return `${who} updated a team member`;
    case "user.deleted": return `${who} removed ${m.name || "a user"}`;
    case "user.password_reset": return `${who} reset the password for ${m.email || "a user"}`;
    case "user.unlocked": return `${who} unlocked an account`;
    case "user.2fa_reset": return `${who} reset two-step sign-in for ${m.email || "a user"}`;
    case "user.sessions_revoked": return `${who} signed a user out of all devices`;
    case "task.created": return `${who} assigned ${t(m)} to ${m.assigned_to || "someone"}`;
    case "task.updated": return `${who} edited ${t(m)}`;
    case "task.deleted": return `${who} deleted ${t(m)}`;
    case "task.started": return `${who} started ${t(m)}`;
    case "task.submitted": return `${who} submitted ${t(m)}${m.file ? ` with ${m.file.name}` : ""}`;
    case "task.approved": return `${who} approved ${t(m)}`;
    case "task.changes_requested": return `${who} requested changes on ${t(m)}`;
    case "task.reopened": return `${who} reopened ${t(m)}`;
    case "task.exported": return `${who} exported ${m.format === "csv" ? "all tasks as CSV" : `${t(m)} as ${String(m.format).toUpperCase()}`}`;
    case "file.blocked": return `File Shield blocked ${m.name || "a file"} from ${who}`;
    case "file.shared": return `${who} sent ${m.name} to ${m.to}`;
    case "file.downloaded": return `${who} downloaded ${m.name || "a file"}`;
    case "file.integrity_failed": return `${m.name || "A file"} failed its integrity check`;
    case "file.hash_banned": return `${who} banned a file fingerprint`;
    case "file.hash_unbanned": return `${who} lifted a file ban`;
    case "p2p.offer": return `${who} offered a direct transfer: ${m.name}`;
    case "settings.updated": return `${who} changed workspace settings`;
    case "security.ip_blocked": return `Export blocked for ${who} from ${m.ip}`;
    case "audit.verified": return `${who} verified the audit log (${m.ok ? "intact" : "TAMPERING FOUND"})`;
    case "task.bulk": return `${who} changed ${m.count} task${m.count === 1 ? "" : "s"} at once (${String(m.action).replace(/_/g, " ")})`;
    case "task.link_added": return `${who} linked ${host(m.url)} to ${t(m)}`;
    case "task.dependency_added": return `${who} marked ${t(m)} as waiting on “${m.depends_on}”`;
    case "project.created": return `${who} created the project ${m.key ? `${m.key} ` : ""}${m.name || ""}`;
    case "project.updated": return `${who} updated the project ${m.name || ""}`;
    case "project.archived": return `${who} archived ${m.name || "a project"}`;
    case "project.restored": return `${who} restored ${m.name || "a project"}`;
    case "project.deleted": return `${who} deleted the project ${m.name || ""}`;
    case "project.members_added": return `${who} added ${m.count} ${m.count === 1 ? "person" : "people"} to ${m.name}`;
    case "project.member_removed": return `${who} removed someone from ${m.name}`;
    case "template.created": return `${who} created the ${m.recurrence && m.recurrence !== "none" ? `${m.recurrence} ` : ""}template “${m.title}”`;
    case "template.deleted": return `${who} deleted the template “${m.title}”`;
    case "team.created": return `${who} created the ${m.name} team`;
    case "team.updated": return `${who} updated the ${m.name} team`;
    case "team.deleted": return `${who} deleted the ${m.name} team`;
    case "token.created": return `${who} created an API token “${m.name}” (${m.scope})`;
    case "token.revoked": return `${who} revoked the API token “${m.name}”`;
    case "webhook.created": return `${who} added a webhook to ${m.host}`;
    case "webhook.updated": return `${who} updated a webhook`;
    case "webhook.deleted": return `${who} deleted the webhook “${m.name}”`;
    case "user.invite_sent": return `${who} sent an invite to ${m.email}`;
    case "user.data_exported": return `${who} downloaded their data`;
    case "auth.reset_requested": return `${who} asked for a password reset link`;
    case "auth.invite_accepted": return `${who} accepted their invite`;
    case "auth.password_reset_by_email": return `${who} reset their password by email`;
    default: return `${who}: ${e.action.replace(/[._]/g, " ")}`;
  }
}

export const isAlarming = (e) =>
  ["file.blocked", "file.integrity_failed", "auth.account_locked", "security.ip_blocked"].includes(e.action) ||
  (e.action === "audit.verified" && e.meta?.ok === false);
