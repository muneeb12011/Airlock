import jwt from "jsonwebtoken";
import { query } from "../db.js";

// Verifies the JWT sent in the Authorization header, confirms the user still
// exists in the DB (so a deleted account is locked out immediately instead of
// staying valid until the token expires), and attaches the user to req.user
export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query("SELECT id, name, email, role FROM users WHERE id = $1", [payload.id]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Account no longer exists" });
    }

    req.user = user; // { id, name, email, role } — always fresh from DB, not just the token
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Only allows admins through
export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access only" });
  }
  next();
}

// Restricts a route to a fixed list of IPs (e.g. office network).
// Set ADMIN_ALLOWED_IPS in .env as a comma-separated list.
// If it's left empty, this check is skipped (open to any IP with a valid admin token).
export function restrictToAllowedIPs(req, res, next) {
  const allowList = (process.env.ADMIN_ALLOWED_IPS || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (allowList.length === 0) return next();

  // req.ip respects the X-Forwarded-For header when "trust proxy" is set in index.js
  const requestIP = req.ip.replace("::ffff:", "");

  if (!allowList.includes(requestIP)) {
    return res.status(403).json({
      error: "Downloads are restricted to approved networks. Contact the admin.",
    });
  }
  next();
}