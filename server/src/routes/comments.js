import express from "express";
import { query } from "../db.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

async function canAccessTask(req, res, next) {
  const task = await query("SELECT * FROM tasks WHERE id = $1", [req.params.taskId]);
  if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });
  const isOwner = task.rows[0].assigned_to === req.user.id;
  if (req.user.role !== "admin" && !isOwner) {
    return res.status(403).json({ error: "Not your task" });
  }
  req.task = task.rows[0];
  next();
}

router.get("/:taskId/comments", authenticate, canAccessTask, async (req, res) => {
  const result = await query(
    `SELECT c.*, u.name AS author_name, u.role AS author_role
     FROM task_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.task_id = $1
     ORDER BY c.created_at ASC`,
    [req.params.taskId]
  );
  res.json(result.rows);
});

router.post("/:taskId/comments", authenticate, canAccessTask, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  const inserted = await query(
    `INSERT INTO task_comments (task_id, user_id, message) VALUES ($1, $2, $3) RETURNING *`,
    [req.params.taskId, req.user.id, message.trim()]
  );
  const withAuthor = await query(
    `SELECT c.*, u.name AS author_name, u.role AS author_role
     FROM task_comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1`,
    [inserted.rows[0].id]
  );
  res.status(201).json(withAuthor.rows[0]);
});

export default router;