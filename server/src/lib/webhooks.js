// Outgoing webhooks: push workspace events to Slack, Discord or any HTTPS
// endpoint. JSON deliveries are signed with HMAC-SHA256 so the receiver can
// verify they really came from this workspace:
//   X-Airlock-Signature: sha256=<hex hmac of "<timestamp>.<body>">
//   X-Airlock-Timestamp: <unix seconds>
import crypto from "crypto";
import { query } from "../db.js";
import { decrypt } from "./crypto.js";
import { assertPublicUrl } from "./netguard.js";
import { appUrl } from "./mailer.js";
import { config } from "../config.js";

export const EVENTS = {
  "task.created": "Task created",
  "task.submitted": "Work submitted for review",
  "task.approved": "Work approved",
  "task.changes_requested": "Changes requested",
  "task.overdue": "Task became overdue",
  "comment.created": "New comment",
  "file.blocked": "File Shield blocked a file",
  "security.account_locked": "Account locked",
};

function summary(event, data) {
  const t = data.task;
  const ref = t ? `${t.key ? `${t.key} ` : ""}“${t.title}”` : "";
  const link = t ? appUrl(`/tasks?task=${t.id}`) : appUrl("/");
  const who = data.actor?.name || "Someone";
  const text = {
    "task.created": `${who} assigned ${ref} to ${t?.assignee_name || "someone"}`,
    "task.submitted": `${who} submitted ${ref} for review`,
    "task.approved": `${who} approved ${ref}`,
    "task.changes_requested": `${who} requested changes on ${ref}${data.note ? `: ${data.note}` : ""}`,
    "task.overdue": `${ref} is overdue (assigned to ${t?.assignee_name || "nobody"})`,
    "comment.created": `${who} commented on ${ref}: ${data.comment || ""}`,
    "file.blocked": `File Shield blocked “${data.file}” from ${who}: ${data.reason}`,
    "security.account_locked": `${data.user}'s account was locked after repeated failed sign-ins`,
  }[event] || event;
  return { text, link };
}

export function buildPayload(format, event, data) {
  const { text, link } = summary(event, data);
  if (format === "slack") return { text: `${text}\n<${link}|Open in ${config.appName}>` };
  if (format === "discord") return { content: `${text}\n${link}`, allowed_mentions: { parse: [] } };
  return { event, text, link, data, sent_at: new Date().toISOString() };
}

async function deliver(hook, event, data) {
  let status = null;
  let error = null;
  try {
    const url = await assertPublicUrl(decrypt(hook.url_enc));
    const body = JSON.stringify(buildPayload(hook.format, event, data));
    const headers = { "Content-Type": "application/json", "User-Agent": `${config.appName}-Webhooks/1.0` };
    if (hook.format === "json" && hook.secret_enc) {
      const ts = Math.floor(Date.now() / 1000);
      headers["X-Airlock-Timestamp"] = String(ts);
      headers["X-Airlock-Signature"] = `sha256=${crypto.createHmac("sha256", decrypt(hook.secret_enc)).update(`${ts}.${body}`).digest("hex")}`;
      headers["X-Airlock-Event"] = event;
    }
    const res = await fetch(url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(6000) });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err.message.slice(0, 300);
  }
  await query(
    `UPDATE webhooks SET last_status = $2, last_error = $3, last_sent_at = now(),
       failure_count = CASE WHEN $3::text IS NULL THEN 0 ELSE failure_count + 1 END,
       active = CASE WHEN $3::text IS NOT NULL AND failure_count + 1 >= 20 THEN false ELSE active END
     WHERE id = $1`,
    [hook.id, status, error]
  ).catch(() => {});
  return { status, error };
}

// Fire-and-forget: never slows down or fails the request that caused it.
export function emitEvent(event, data = {}, { projectId = null } = {}) {
  (async () => {
    const { rows } = await query(
      `SELECT * FROM webhooks WHERE active AND $1 = ANY(events) AND (project_id IS NULL OR project_id = $2)`,
      [event, projectId]
    );
    await Promise.all(rows.map((h) => deliver(h, event, data)));
  })().catch((err) => console.error("[webhooks]", err.message));
}

export async function sendTest(hook) {
  return deliver(hook, "task.created", {
    actor: { name: config.appName },
    task: { id: 0, key: "TEST-1", title: "This is a test delivery", assignee_name: "you" },
  });
}
