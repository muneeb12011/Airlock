// Global search behind the ⌘K palette: tasks (by text or key like WEB-12),
// projects and people — limited to what the caller can see.
import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse } from "../lib/http.js";
import { taskVisibility, projectVisibility } from "../lib/access.js";
import { avatarUrl } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const key = q.match(/^([A-Za-z][A-Za-z0-9]{1,7})-(\d+)$/);

  const tp = [];
  const tvis = taskVisibility(req.user, tp);
  let tcond;
  if (key) {
    tp.push(key[1].toUpperCase(), Number(key[2]));
    tcond = `p.key = $${tp.length - 1} AND t.number = $${tp.length}`;
  } else {
    tp.push(like);
    tcond = `(t.title ILIKE $${tp.length} OR t.description ILIKE $${tp.length} OR $${tp.length} ILIKE ANY(SELECT '%' || l || '%' FROM unnest(t.labels) l))`;
  }
  const pp = [];
  const pvis = projectVisibility(req.user, pp);
  pp.push(like);

  const [tasks, projects, people] = await Promise.all([
    query(
      `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.key || '-' || t.number AS key, p.color AS project_color, a.name AS assignee_name
       FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN users a ON a.id = t.assigned_to
       WHERE ${tvis} AND ${tcond}
       ORDER BY (t.status = 'completed'), t.updated_at DESC LIMIT 8`,
      tp
    ),
    query(
      `SELECT p.id, p.key, p.name, p.color, p.kind, p.status FROM projects p
       WHERE ${pvis} AND (p.name ILIKE $${pp.length} OR p.key ILIKE $${pp.length}) ORDER BY p.status, p.name LIMIT 5`,
      pp
    ),
    query(
      `SELECT id, name, title, role, avatar_file_id FROM users WHERE is_active AND (name ILIKE $1 OR title ILIKE $1) ORDER BY name LIMIT 5`,
      [like]
    ),
  ]);
  res.json({
    tasks: tasks.rows,
    projects: projects.rows,
    people: people.rows.map(({ avatar_file_id, ...u }) => ({ ...u, avatar_url: avatarUrl(avatar_file_id) })),
  });
});

export default router;
