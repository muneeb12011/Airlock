import { query } from "../db.js";
import { emitToUser } from "./realtime.js";
import { sendMail, emailEnabled, appUrl } from "./mailer.js";

// Which notification types can also go out by email, and the profile
// preference that controls each.
const EMAIL_PREF = {
  task: "email_assigned",
  review: "email_review",
  mention: "email_mention",
  security: "email_security",
};

// Persists an in-app notification, pushes it live, and emails it when the
// user has opted in and email is configured.
export async function notify(userIds, { type, title, body = null, link = null, email = true }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean).map(Number))];
  for (const userId of ids) {
    try {
      const { rows } = await query(
        `INSERT INTO notifications (user_id, type, title, body, link)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [userId, type, title, body, link]
      );
      emitToUser(userId, "notification:new", rows[0]);

      const pref = EMAIL_PREF[type];
      if (email && pref && emailEnabled()) {
        const u = await query(`SELECT email, name, notify_prefs, is_active FROM users WHERE id = $1`, [userId]);
        const user = u.rows[0];
        if (user?.is_active && user.notify_prefs?.[pref] !== false) {
          sendMail({
            to: user.email,
            subject: title,
            heading: title,
            text: body || "",
            cta: link ? "Open" : null,
            ctaUrl: link ? appUrl(link) : null,
            footer: "Change which emails you get under Profile → Notifications.",
          });
        }
      }
    } catch (err) {
      console.error("[notify] failed:", err.message);
    }
  }
}

export async function adminIds() {
  const { rows } = await query(`SELECT id FROM users WHERE role = 'admin' AND is_active`);
  return rows.map((r) => r.id);
}

export async function notifyAdmins(payload, { except } = {}) {
  const ids = (await adminIds()).filter((id) => id !== except);
  return notify(ids, payload);
}

// Everyone who should hear about a task's review activity: whoever assigned
// it plus the managers of its project (falls back to admins).
export async function reviewerIds(task) {
  const ids = new Set();
  if (task.assigned_by) ids.add(task.assigned_by);
  if (task.project_id) {
    const { rows } = await query(
      `SELECT u.id FROM users u JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND u.role IN ('admin','manager') AND u.is_active
       UNION SELECT owner_id FROM projects WHERE id = $1 AND owner_id IS NOT NULL`,
      [task.project_id]
    );
    rows.forEach((r) => ids.add(r.id));
  }
  if (ids.size === 0) (await adminIds()).forEach((id) => ids.add(id));
  ids.delete(task.assigned_to);
  return [...ids];
}
