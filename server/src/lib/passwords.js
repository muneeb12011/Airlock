import bcrypt from "bcryptjs";
import { sha1Hex } from "./sha1.js";

const COMMON = new Set([
  "password", "password1", "password123", "123456789", "1234567890", "qwerty123",
  "qwertyuiop", "iloveyou1", "admin12345", "welcome123", "letmein123", "football1",
  "baseball1", "abc1234567", "pakistan123", "passw0rd!", "p@ssw0rd123", "changeme123",
]);

export const MIN_LENGTH = 10;
export const hashPassword = (pw) => bcrypt.hash(pw, 12);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

// Used when the email doesn't exist so a failed login takes the same time
// either way (stops attackers from discovering which emails have accounts).
const DUMMY_HASH = bcrypt.hashSync("airlock-timing-equaliser", 12);
export const burnTime = (pw) => bcrypt.compare(pw || "", DUMMY_HASH);

/**
 * Checks a password against the Have I Been Pwned breach corpus using
 * k-anonymity: only the first 5 characters of its SHA-1 leave the server,
 * never the password. Returns the breach count, or null if the check could
 * not run (offline, timeout) — callers treat null as "allow".
 */
export async function breachCount(pw) {
  if (process.env.CHECK_BREACHED_PASSWORDS === "false") return null;
  const hash = sha1Hex(pw).toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "airlock-password-check" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split("\n")) {
      const [s, count] = line.trim().split(":");
      if (s === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

// Returns an error message, or null if the password is acceptable.
export async function passwordProblem(pw, { email, name } = {}) {
  if (typeof pw !== "string" || pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (pw.length > 200) return "That password is too long.";
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return "That password is on every attacker's list. Pick something less common.";
  if (/^(.)\1+$/.test(pw)) return "Don't use one repeated character.";
  if (email && lower.includes(String(email).split("@")[0].toLowerCase()) && String(email).split("@")[0].length >= 4) {
    return "Don't include your email name in your password.";
  }
  if (name && name.length >= 4 && lower.includes(name.toLowerCase().split(" ")[0])) {
    return "Don't include your name in your password.";
  }
  const count = await breachCount(pw);
  if (count && count > 0) {
    return `This password has appeared in ${count.toLocaleString()} known data breaches. Attackers try these first — choose a different one.`;
  }
  return null;
}
