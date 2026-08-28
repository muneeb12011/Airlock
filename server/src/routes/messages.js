import express from "express";
import multer from "multer";
import fs from "fs";
import { query } from "../db.js";
import { authenticate } from "../middleware/auth.js";

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

// Admin -> list of members they can message. Member -> the admin they can message.
router.get("/contacts", authenticate, async (req, res) => {
  if (req.user.role === "admin") {
    const result = await query("SELECT id, name, email FROM users WHERE role = 'member' ORDER BY name");
    res.json(result.rows);
  } else {
    const result = await query("SELECT id, name, email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    res.json(result.rows);
  }
});

async function canMessage(req, res, next) {
  const other = await query("SELECT * FROM users WHERE id = $1", [req.params.otherUserId]);
  if (!other.rows[0]) return res.status(404).json({ error: "User not found" });
  if (req.user.role === "admin" && other.rows[0].role !== "member") {
    return res.status(403).json({ error: "Admins can only message members" });
  }
  if (req.user.role === "member" && other.rows[0].role !== "admin") {
    return res.status(403).json({ error: "Members can only message admins" });
  }
  next();
}

router.get("/:otherUserId", authenticate, canMessage, async (req, res) => {
  const result = await query(
    `SELECT * FROM messages
     WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
     ORDER BY created_at ASC`,
    [req.user.id, req.params.otherUserId]
  );
  res.json(result.rows);
});

router.post("/:otherUserId", authenticate, canMessage, upload.single("file"), async (req, res) => {
  const message = (req.body.message || "").trim();
  if (!message && !req.file) {
    return res.status(400).json({ error: "message or file is required" });
  }
  const result = await query(
    `INSERT INTO messages (sender_id, recipient_id, message, file_path, file_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      req.user.id,
      req.params.otherUserId,
      message || null,
      req.file ? req.file.path : null,
      req.file ? req.file.originalname : null,
    ]
  );
  res.status(201).json(result.rows[0]);
});

// Download an attachment from a message — only the sender or recipient can access it
router.get("/file/:messageId", authenticate, async (req, res) => {
  const msg = await query("SELECT * FROM messages WHERE id = $1", [req.params.messageId]);
  if (!msg.rows[0] || !msg.rows[0].file_path) {
    return res.status(404).json({ error: "No attachment found" });
  }
  const row = msg.rows[0];
  if (req.user.id !== row.sender_id && req.user.id !== row.recipient_id) {
    return res.status(403).json({ error: "Not your message" });
  }
  res.download(row.file_path, row.file_name || "attachment");
});

export default router;