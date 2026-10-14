import express from "express";
import { z } from "zod";
import { query } from "../db.js";
import { parse } from "../lib/http.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = await query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.id]
  );
  res.json({ items: rows, unread: unread.rows[0].n });
});

const readSchema = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() });

router.post("/read", async (req, res) => {
  const { ids } = parse(readSchema, req.body);
  if (ids?.length) {
    await query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::int[]) AND read_at IS NULL`,
      [req.user.id, ids]
    );
  } else {
    await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  }
  res.json({ ok: true });
});

export default router;
