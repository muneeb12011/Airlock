// Profile pictures. Served without auth so <img> tags work across origins,
// but only for files that are currently someone's avatar, addressed by an
// unguessable UUID, and only as real raster images.
import express from "express";
import fs from "fs";
import path from "path";
import { query } from "../db.js";
import { config } from "../config.js";

const router = express.Router();
const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

router.get("/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).end();
  const { rows } = await query(
    `SELECT f.storage_key, f.detected_type FROM files f JOIN users u ON u.avatar_file_id = f.id WHERE f.id = $1`,
    [id]
  );
  const f = rows[0];
  if (!f || !TYPES[f.detected_type]) return res.status(404).end();
  const full = path.join(config.uploadDir, path.basename(f.storage_key));
  if (!fs.existsSync(full)) return res.status(404).end();
  res.setHeader("Content-Type", TYPES[f.detected_type]);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=86400, immutable");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  fs.createReadStream(full).pipe(res);
});

export default router;
