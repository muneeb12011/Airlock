import express from "express";
import path from "path";
import fs from "fs";
import { query } from "../db.js";
import { authenticate, requireAdmin, restrictToAllowedIPs } from "../middleware/auth.js";
import { generateTaskPDF, generateTaskDocx } from "../services/export.js";

const router = express.Router();

// Every route below requires: valid admin JWT + (optionally) an approved IP.
router.use(authenticate, requireAdmin, restrictToAllowedIPs);

// GET /admin/tasks/:id/download?format=pdf|docx
router.get("/tasks/:id/download", async (req, res) => {
  const format = req.query.format === "docx" ? "docx" : "pdf";

  const taskResult = await query(
    `SELECT t.*, u.name AS assignee_name
     FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.id = $1`,
    [req.params.id]
  );
  const task = taskResult.rows[0];
  if (!task) return res.status(404).json({ error: "Task not found" });

  const submissionResult = await query(
    "SELECT * FROM task_submissions WHERE task_id = $1 ORDER BY submitted_at DESC LIMIT 1",
    [req.params.id]
  );
  const submission = submissionResult.rows[0];

  if (format === "pdf") {
    generateTaskPDF(task, submission, res);
  } else {
    await generateTaskDocx(task, submission, res);
  }
});

// GET /admin/tasks/:id/file - downloads the raw file the member attached to their submission
router.get("/tasks/:id/file", async (req, res) => {
  const submissionResult = await query(
    "SELECT * FROM task_submissions WHERE task_id = $1 ORDER BY submitted_at DESC LIMIT 1",
    [req.params.id]
  );
  const submission = submissionResult.rows[0];
  if (!submission || !submission.file_path) {
    return res.status(404).json({ error: "No file attached to this submission" });
  }
  res.download(path.resolve(submission.file_path));
});

// GET /admin/login-logs - who logged in and when
router.get("/login-logs", async (req, res) => {
  const result = await query(
    `SELECT l.id, l.ip_address, l.user_agent, l.login_at, u.name, u.email, u.role
     FROM login_logs l JOIN users u ON u.id = l.user_id
     ORDER BY l.login_at DESC
     LIMIT 200`
  );
  res.json(result.rows);
});

// GET /admin/users - list team members (for the "assign task" dropdown)
router.get("/users", async (req, res) => {
  const result = await query(
    "SELECT id, name, email, role FROM users ORDER BY name"
  );
  res.json(result.rows);
});

// Helper: delete a file from disk if it exists, without crashing the request
// if it's already gone or the path is bad.
function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  } catch (err) {
    console.error(`Failed to delete file ${filePath}:`, err.message);
  }
}

// DELETE /admin/users/:id - removes a team member (or admin) entirely:
// deletes every file they're tied to on disk, then all their DB rows in
// dependency order, then the user row itself. Their JWT stops working on
// their very next request since authenticate() rechecks the DB.
router.delete("/users/:id", async (req, res) => {
  const userId = req.params.id;

  if (String(req.user.id) === String(userId)) {
    return res.status(400).json({ error: "You can't delete your own account" });
  }

  const target = await query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!target.rows[0]) {
    return res.status(404).json({ error: "User not found" });
  }

  try {
    // 1. Collect every file on disk tied to this user, from both directions.
    const submissionFiles = await query(
      `SELECT s.file_path FROM task_submissions s
       JOIN tasks t ON t.id = s.task_id
       WHERE s.submitted_by = $1 OR t.assigned_to = $1`,
      [userId]
    );
    const messageFiles = await query(
      `SELECT file_path FROM messages WHERE sender_id = $1 OR recipient_id = $1`,
      [userId]
    );
    [...submissionFiles.rows, ...messageFiles.rows].forEach((row) => safeUnlink(row.file_path));

    // 2. Delete DB rows in dependency order (users has no ON DELETE CASCADE
    //    of its own, so this has to be done by hand).
    await query(`DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1`, [userId]);
    await query(`DELETE FROM login_logs WHERE user_id = $1`, [userId]);

    // Tasks assigned to this member: deleting the task cascades to its own
    // task_comments and task_submissions (both ON DELETE CASCADE on tasks.id).
    await query(`DELETE FROM tasks WHERE assigned_to = $1`, [userId]);

    // Comments this user wrote on tasks that remain (e.g. an admin's comments).
    await query(`DELETE FROM task_comments WHERE user_id = $1`, [userId]);

    // If this user ever assigned tasks as an admin, don't orphan those tasks —
    // just clear who assigned them.
    await query(`UPDATE tasks SET assigned_by = NULL WHERE assigned_by = $1`, [userId]);

    // Any leftover submissions by this user on tasks assigned to someone else.
    await query(`DELETE FROM task_submissions WHERE submitted_by = $1`, [userId]);

    // 3. Finally, the user row itself.
    await query(`DELETE FROM users WHERE id = $1`, [userId]);

    res.json({ success: true, deletedUser: { id: target.rows[0].id, name: target.rows[0].name } });
  } catch (err) {
    console.error("Failed to delete user:", err);
    res.status(500).json({ error: "Failed to delete user — check server logs" });
  }
});

export default router;