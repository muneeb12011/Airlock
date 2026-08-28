import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { query } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || "uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
});

const VALID_TYPES = ["feature", "bug", "docs", "research", "review", "other"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

// --- Admin: create + assign a task to one of the team members ---
router.post("/", authenticate, requireAdmin, async (req, res) => {
  const { title, description, assigned_to, due_date, type, priority } = req.body;
  if (!title || !assigned_to) {
    return res.status(400).json({ error: "title and assigned_to are required" });
  }

  const safeType = VALID_TYPES.includes(type) ? type : "other";
  const safePriority = VALID_PRIORITIES.includes(priority) ? priority : "medium";

  const result = await query(
    `INSERT INTO tasks (title, description, assigned_to, assigned_by, due_date, type, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [title, description || null, assigned_to, req.user.id, due_date || null, safeType, safePriority]
  );
  res.status(201).json(result.rows[0]);
});

// --- List tasks: admin sees all, member sees only their own ---
router.get("/", authenticate, async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const result = await query(
    `SELECT t.*, u.name AS assignee_name,
       EXISTS (
         SELECT 1 FROM task_submissions s
         WHERE s.task_id = t.id AND s.file_path IS NOT NULL
       ) AS has_attachment
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     ${isAdmin ? "" : "WHERE t.assigned_to = $1"}
     ORDER BY t.created_at DESC`,
    isAdmin ? [] : [req.user.id]
  );
  res.json(result.rows);
});

// --- Get single task with its submission (if any) ---
router.get("/:id", authenticate, async (req, res) => {
  const task = await query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
  if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });

  const isOwner = task.rows[0].assigned_to === req.user.id;
  if (req.user.role !== "admin" && !isOwner) {
    return res.status(403).json({ error: "Not your task" });
  }

  const submission = await query(
    "SELECT * FROM task_submissions WHERE task_id = $1 ORDER BY submitted_at DESC LIMIT 1",
    [req.params.id]
  );

  res.json({ ...task.rows[0], submission: submission.rows[0] || null });
});

// --- Member updates status (in_progress) ---
router.patch("/:id/status", authenticate, async (req, res) => {
  const { status } = req.body;
  const task = await query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
  if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });
  if (req.user.role !== "admin" && task.rows[0].assigned_to !== req.user.id) {
    return res.status(403).json({ error: "Not your task" });
  }
  const result = await query(
    "UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    [status, req.params.id]
  );
  res.json(result.rows[0]);
});

// --- Member submits the completed work (notes + optional file) ---
router.post(
  "/:id/submit",
  authenticate,
  upload.single("file"),
  async (req, res) => {
    const task = await query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    if (!task.rows[0]) return res.status(404).json({ error: "Task not found" });
    if (req.user.role !== "admin" && task.rows[0].assigned_to !== req.user.id) {
      return res.status(403).json({ error: "Not your task" });
    }

    const filePath = req.file ? req.file.path : null;

    const submission = await query(
      `INSERT INTO task_submissions (task_id, submitted_by, notes, file_path)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, req.user.id, req.body.notes || null, filePath]
    );

    await query(
      "UPDATE tasks SET status = 'completed', updated_at = now() WHERE id = $1",
      [req.params.id]
    );

    // If a file was submitted, drop it into the chat with the admin too,
    // so it shows up in Messages without them having to dig through Tasks.
    if (req.file) {
      const admin = await query(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1"
      );
      if (admin.rows[0]) {
        await query(
          `INSERT INTO messages (sender_id, recipient_id, message, file_path, file_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            req.user.id,
            admin.rows[0].id,
            `Submitted work for "${task.rows[0].title}"`,
            req.file.path,
            req.file.originalname,
          ]
        );
      }
    }

    res.status(201).json(submission.rows[0]);
  }
);

export default router;