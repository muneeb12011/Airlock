// RFC 6238 TOTP (the 6-digit codes from Google Authenticator, 1Password,
// Authy, Microsoft Authenticator...). No third-party service involved.
import crypto from "crypto";
import { sha256 } from "./crypto.js";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

export function codeAt(secret, step) {
  return hotp(base32Decode(secret), step);
}

// Returns the matching time-step (so callers can block replays), or null.
// Accepts one step of clock drift either way.
export function verifyTotp(secret, code, { lastStep = null, now = Date.now() } = {}) {
  const clean = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const key = base32Decode(secret);
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= Number(lastStep)) continue; // already used
    const expected = hotp(key, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return s;
  }
  return null;
}

export function otpauthUrl({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params}`;
}

// Recovery codes: 10 one-time codes like "7kq2-m9xd". Stored as SHA-256
// hashes — they're high-entropy random strings, so a fast hash is fine.
export function generateRecoveryCodes(n = 10) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const part = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  const codes = Array.from({ length: n }, () => `${part()}-${part()}`);
  return { codes, hashes: codes.map((c) => sha256(c)) };
}

export const normalizeRecoveryCode = (c) => String(c || "").trim().toLowerCase().replace(/\s+/g, "");
