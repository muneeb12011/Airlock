// Admin-managed outgoing webhooks (Slack, Discord, or any HTTPS endpoint).
import express from "express";
import { z } from "zod";
import crypto from "crypto";
import { query } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { parse, intParam, notFound, badRequest } from "../lib/http.js";
import { encrypt } from "../lib/crypto.js";
import { assertPublicUrl } from "../lib/netguard.js";
import { EVENTS, sendTest } from "../lib/webhooks.js";
import { audit } from "../lib/audit.js";

const router = express.Router();
router.use(requireAdmin);

const shape = ({ url_enc, secret_enc, ...h }) => ({ ...h, has_secret: Boolean(secret_enc) });

const hint = (u) => {
  const url = new URL(u);
  const tail = url.pathname.length > 6 ? `…${url.pathname.slice(-4)}` : url.pathname;
  return `${url.hostname}${tail}`.slice(0, 120);
};

router.get("/webhooks", async (_req, res) => {
  const { rows } = await query(
    `SELECT w.*, p.name AS project_name FROM webhooks w LEFT JOIN projects p ON p.id = w.project_id ORDER BY w.created_at DESC`
  );
  res.json({ events: EVENTS, webhooks: rows.map(shape) });
});

const hookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().max(2000),
  format: z.enum(["json", "slack", "discord"]).default("json"),
  events: z.array(z.enum(Object.keys(EVENTS))).min(1, "Pick at least one event"),
  project_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});

async function checkUrl(url) {
  try {
    await assertPublicUrl(url);
  } catch (err) {
    throw badRequest(err.message, { field: "url" });
  }
}

router.post("/webhooks", async (req, res) => {
  const b = parse(hookSchema, req.body);
  await checkUrl(b.url);
  const secret = b.format === "json" ? crypto.randomBytes(24).toString("hex") : null;
  const { rows } = await query(
    `INSERT INTO webhooks (name, url_enc, url_hint, format, secret_enc, events, project_id, active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.name, encrypt(b.url), hint(b.url), b.format, secret ? encrypt(secret) : null, b.events, b.project_id || null, b.active, req.user.id]
  );
  await audit(req, "webhook.created", { targetType: "webhook", targetId: rows[0].id, meta: { name: b.name, host: new URL(b.url).hostname, events: b.events } });
  // The signing secret is shown once.
  res.status(201).json({ ...shape(rows[0]), secret });
});

router.patch("/webhooks/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const b = parse(hookSchema.partial(), req.body);
  const sent = new Set(Object.keys(req.body || {}));
  const sets = [];
  const params = [id];
  const set = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (sent.has("url")) {
    await checkUrl(b.url);
    set("url_enc", encrypt(b.url));
    set("url_hint", hint(b.url));
  }
  for (const k of ["name", "format", "events", "project_id", "active"]) if (sent.has(k)) set(k, b[k] ?? null);
  if (sent.has("active") && b.active) set("failure_count", 0);
  if (!sets.length) throw badRequest("Nothing to change.");
  const { rows } = await query(`UPDATE webhooks SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  if (!rows[0]) throw notFound("Webhook not found");
  await audit(req, "webhook.updated", { targetType: "webhook", targetId: id, meta: { fields: [...sent].filter((k) => k !== "url") } });
  res.json(shape(rows[0]));
});

router.delete("/webhooks/:id", async (req, res) => {
  const id = intParam(req.params.id);
  const { rows } = await query(`DELETE FROM webhooks WHERE id = $1 RETURNING name`, [id]);
  if (!rows[0]) throw notFound("Webhook not found");
  await audit(req, "webhook.deleted", { targetType: "webhook", targetId: id, meta: { name: rows[0].name } });
  res.json({ ok: true });
});

router.post("/webhooks/:id/test", async (req, res) => {
  const { rows } = await query(`SELECT * FROM webhooks WHERE id = $1`, [intParam(req.params.id)]);
  if (!rows[0]) throw notFound("Webhook not found");
  const result = await sendTest(rows[0]);
  res.json(result);
});

export default router;
