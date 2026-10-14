// Tamper-evident audit log.
//
// Every entry stores the hash of the entry before it, and its own hash is
// SHA-256(prev_hash | canonical(entry)). Editing, deleting or reordering any
// past row breaks every hash after it, and verifyChain() pinpoints where.
// The table also has a DB trigger that rejects UPDATE/DELETE/TRUNCATE.
//
// Honest limit: someone with full superuser access to the database could
// drop the trigger and recompute the entire chain. Record the head hash
// somewhere outside the DB (the Security page shows it) to detect that too.
import { pool } from "../db.js";
import { sha256 } from "./crypto.js";
import { clientIp } from "./ip.js";

export const GENESIS = "0".repeat(64);
const LOCK_ID = 727_002;

function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeHash(prevHash, row) {
  const body = canonical({
    actor_id: row.actor_id ?? null,
    actor_name: row.actor_name ?? null,
    action: row.action,
    target_type: row.target_type ?? null,
    target_id: row.target_id ?? null,
    meta: row.meta ?? {},
    ip_address: row.ip_address ?? null,
    created_at: new Date(row.created_at).toISOString(),
  });
  return sha256(`${prevHash}|${body}`);
}

/**
 * audit(req|null, action, { target, meta, actor })
 * Never throws — a failed audit write is logged, not surfaced to the user.
 */
export async function audit(req, action, { targetType = null, targetId = null, meta = {}, actor = null } = {}) {
  const who = actor || req?.user || null;
  const row = {
    actor_id: who?.id ?? null,
    actor_name: who?.name ?? who?.email ?? null,
    action,
    target_type: targetType,
    target_id: targetId === null || targetId === undefined ? null : String(targetId),
    meta: JSON.parse(JSON.stringify(meta || {})),
    ip_address: req ? clientIp(req) : null,
    created_at: new Date(),
  };

  const client = await pool.connect().catch((e) => {
    console.error("[audit] no db connection:", e.message);
    return null;
  });
  if (!client) return;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const last = await client.query("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prevHash = last.rows[0]?.hash || GENESIS;
    const hash = computeHash(prevHash, row);
    await client.query(
      `INSERT INTO audit_log (actor_id, actor_name, action, target_type, target_id, meta, ip_address, created_at, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.actor_id, row.actor_name, row.action, row.target_type, row.target_id, row.meta, row.ip_address, row.created_at, prevHash, hash]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[audit] failed to record", action, err.message);
  } finally {
    client.release();
  }
}

// Walks the whole chain in id order and recomputes every hash.
export async function verifyChain() {
  let prev = GENESIS;
  let lastId = 0;
  let checked = 0;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE id > $1 ORDER BY id ASC LIMIT 1000`,
      [lastId]
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prev_hash !== prev) {
        return { ok: false, checked, brokenAt: r.id, reason: "Link to previous entry is broken (a row was removed or reordered)", head: prev };
      }
      const expected = computeHash(prev, r);
      if (expected !== r.hash) {
        return { ok: false, checked, brokenAt: r.id, reason: "Entry contents were changed after it was written", head: prev };
      }
      prev = r.hash;
      lastId = r.id;
      checked++;
    }
  }
  return { ok: true, checked, brokenAt: null, reason: null, head: prev };
}
