// Single-use links for email invites and password resets. Only a SHA-256
// of the token is stored, so a database leak doesn't leak working links.
import crypto from "crypto";
import { query } from "../db.js";
import { sha256 } from "./crypto.js";

export async function createAuthToken(userId, purpose, minutes) {
  const token = crypto.randomBytes(32).toString("base64url");
  // A new link replaces any older unused one for the same purpose.
  await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  await query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [sha256(token), userId, purpose, String(minutes)]
  );
  return token;
}

export async function peekAuthToken(token) {
  if (!token || token.length > 200) return null;
  const { rows } = await query(
    `SELECT a.user_id, a.purpose, u.name, u.email FROM auth_tokens a JOIN users u ON u.id = a.user_id
     WHERE a.token_hash = $1 AND a.used_at IS NULL AND a.expires_at > now() AND u.is_active`,
    [sha256(token)]
  );
  return rows[0] || null;
}

export async function consumeAuthToken(token) {
  const { rowCount } = await query(
    `UPDATE auth_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token)]
  );
  return rowCount === 1;
}
