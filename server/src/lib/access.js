// Central permission rules.
//
//  admin   — everything.
//  manager — creates projects; creates, edits, assigns and reviews tasks in
//            projects they belong to (and tasks they created); sees reports
//            for those projects.
//  member  — sees tasks assigned to them plus every task in projects they
//            belong to; works on their own tasks; comments on anything they
//            can see.
import { query } from "../db.js";
import { getSettings } from "./settings.js";

export const isAdmin = (u) => u?.role === "admin";
export const isManager = (u) => u?.role === "manager";
export const canLead = (u) => isAdmin(u) || isManager(u);

// SQL condition restricting tasks (alias t) to what `user` may see.
// Returns { sql, params } — params are appended to `params` you pass in.
export function taskVisibility(user, params, alias = "t") {
  if (isAdmin(user)) return "TRUE";
  params.push(user.id);
  const p = `$${params.length}`;
  return `(${alias}.assigned_to = ${p}
    OR ${alias}.assigned_by = ${p}
    OR ${alias}.project_id IN (SELECT project_id FROM project_members WHERE user_id = ${p}))`;
}

export function projectVisibility(user, params, alias = "p") {
  if (isAdmin(user)) return "TRUE";
  params.push(user.id);
  const p = `$${params.length}`;
  return `(${alias}.owner_id = ${p} OR ${alias}.id IN (SELECT project_id FROM project_members WHERE user_id = ${p}))`;
}

export async function isProjectMember(userId, projectId) {
  if (!projectId) return false;
  const { rows } = await query(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
     UNION SELECT 1 FROM projects WHERE id = $1 AND owner_id = $2`,
    [projectId, userId]
  );
  return rows.length > 0;
}

export async function canSeeTask(user, task) {
  if (isAdmin(user)) return true;
  if (task.assigned_to === user.id || task.assigned_by === user.id) return true;
  return isProjectMember(user.id, task.project_id);
}

export async function canManageTask(user, task) {
  if (isAdmin(user)) return true;
  if (!isManager(user)) return false;
  if (task.assigned_by === user.id && !task.project_id) return true;
  return isProjectMember(user.id, task.project_id);
}

export async function canManageProject(user, project) {
  if (isAdmin(user)) return true;
  if (!isManager(user)) return false;
  return project.owner_id === user.id || isProjectMember(user.id, project.id);
}

export async function shareTeamOrProject(a, b) {
  const { rows } = await query(
    `SELECT 1 FROM team_members x JOIN team_members y ON x.team_id = y.team_id WHERE x.user_id = $1 AND y.user_id = $2
     UNION
     SELECT 1 FROM project_members x JOIN project_members y ON x.project_id = y.project_id WHERE x.user_id = $1 AND y.user_id = $2
     LIMIT 1`,
    [a, b]
  );
  return rows.length > 0;
}

// Direct messages: leads (admins/managers) can message anyone. Members can
// always reach leads; member-to-member depends on the workspace setting.
export async function canMessage(from, to) {
  if (!to || !to.is_active || from.id === to.id) return false;
  if (canLead(from) || canLead(to)) return true;
  const { member_dm } = await getSettings();
  if (member_dm === "all") return true;
  if (member_dm === "team") return shareTeamOrProject(from.id, to.id);
  return false;
}
