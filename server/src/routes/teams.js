// Teams group people (Marketing, Engineering, Design…). Admins manage teams;
// a team's lead can add and remove its members.
import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse, intParam, notFound, forbidden, conflict } from "../lib/http.js";
import { isAdmin } from "../lib/access.js";
import { audit } from "../lib/audit.js";
import { avatarUrl } from "../middleware/auth.js";

const router = express.Router();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0e5f50");
const teamSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  color: color.optional(),
  lead_id: z.number().int().positive().nullable().optional(),
  member_ids: z.array(z.number().int().positive()).max(500).optional(),
});

async function loadTeam(id) {
  const { rows } = await query(`SELECT * FROM teams WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound("Team not found");
  return rows[0];
}

router.get("/", async (_req, res) => {
  const { rows } = await query(`
    SELECT t.*, l.name AS lead_name,
      COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name, 'title', u.title, 'role', u.role, 'avatar_file_id', u.avatar_file_id)
        ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL), '[]') AS members,
      (SELECT COUNT(*)::int FROM projects p WHERE p.team_id = t.id AND p.status = 'active') AS project_count
    FROM teams t
    LEFT JOIN users l ON l.id = t.lead_id
    LEFT JOIN team_members m ON m.team_id = t.id
    LEFT JOIN users u ON u.id = m.user_id AND u.is_active
    GROUP BY t.id, l.name ORDER BY t.name`);
  res.json(
    rows.map((t) => ({
      ...t,
      members: t.members.map(({ avatar_file_id, ...m }) => ({ ...m, avatar_url: avatarUrl(avatar_file_id) })),
    }))
  );
});

async function setMembers(teamId, ids) {
  if (!Array.isArray(ids)) return;
  await query(`DELETE FROM team_members WHERE team_id = $1 AND NOT (user_id = ANY($2::int[]))`, [teamId, ids]);
  if (ids.length) {
    await query(
      `INSERT INTO team_members (team_id, user_id) SELECT $1, id FROM users WHERE id = ANY($2::int[]) ON CONFLICT DO NOTHING`,
      [teamId, ids]
    );
  }
}

router.post("/", async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden("Only admins can create teams.");
  const body = parse(teamSchema, req.body);
  try {
    const { rows } = await query(
      `INSERT INTO teams (name, description, color, lead_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [body.name, body.description || null, body.color || "#0e5f50", body.lead_id || null]
    );
    const members = [...new Set([...(body.member_ids || []), ...(body.lead_id ? [body.lead_id] : [])])];
    await setMembers(rows[0].id, members);
    await audit(req, "team.created", { targetType: "team", targetId: rows[0].id, meta: { name: body.name } });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") throw conflict("A team with that name already exists.");
    throw err;
  }
});

router.patch("/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const team = await loadTeam(id);
  const lead = team.lead_id === req.user.id;
  if (!isAdmin(req.user) && !lead) throw forbidden("Only admins and the team lead can change this team.");
  const body = parse(teamSchema.partial(), req.body);
  const sent = new Set(Object.keys(req.body || {}));
  if (!isAdmin(req.user) && [...sent].some((k) => k !== "member_ids")) throw forbidden("Team leads can only change who's on the team.");

  const fields = ["name", "description", "color", "lead_id"].filter((k) => sent.has(k));
  if (fields.length) {
    try {
      await query(
        `UPDATE teams SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [id, ...fields.map((k) => body[k] ?? null)]
      );
    } catch (err) {
      if (err.code === "23505") throw conflict("A team with that name already exists.");
      throw err;
    }
  }
  if (sent.has("member_ids")) {
    const lead_id = sent.has("lead_id") ? body.lead_id : team.lead_id;
    await setMembers(id, [...new Set([...(body.member_ids || []), ...(lead_id ? [lead_id] : [])])]);
  }
  await audit(req, "team.updated", { targetType: "team", targetId: id, meta: { name: body.name || team.name, fields: [...sent] } });
  res.json(await loadTeam(id));
});

router.delete("/:id", async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden("Only admins can delete teams.");
  const id = intParam(req.params.id);
  const team = await loadTeam(id);
  await query(`DELETE FROM teams WHERE id = $1`, [id]);
  await audit(req, "team.deleted", { targetType: "team", targetId: id, meta: { name: team.name } });
  res.json({ ok: true });
});

export default router;
