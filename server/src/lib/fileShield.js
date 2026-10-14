// File Shield — every file that enters Airlock passes through here.
//
// Malicious attachments are one of the most common ways ransomware and
// spyware get into organisations: an .exe renamed to "invoice.pdf", a
// filename using a hidden right-to-left character so "invoice‮fdp.exe"
// displays as "invoiceexe.pdf", a password-protected zip that email scanners
// can't open, a Word file carrying macros. File Shield checks for those
// patterns by reading the actual bytes, not trusting the name or the
// browser-reported MIME type, and fingerprints every file with SHA-256 so
// the copy downloaded later is provably the copy that was uploaded.
//
// Optional: set CLAMAV_HOST to also stream every upload through a ClamAV
// daemon for signature-based virus scanning.
import fs from "fs";
import fsp from "fs/promises";
import net from "net";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { config } from "../config.js";
import { query } from "../db.js";
import { sha256File } from "./crypto.js";
import { HttpError } from "./http.js";
import { audit } from "./audit.js";
import { clientIp } from "./ip.js";
import { notifyAdmins } from "./notify.js";

const TMP_DIR = path.join(config.uploadDir, ".incoming");
fs.mkdirSync(TMP_DIR, { recursive: true });

// Extensions whose real content we can reliably verify from magic bytes.
const EXPECTED = {
  pdf: ["pdf"],
  png: ["png"],
  jpg: ["jpg"],
  jpeg: ["jpg"],
  gif: ["gif"],
  webp: ["webp"],
  bmp: ["bmp"],
  tif: ["tif"],
  tiff: ["tif"],
  mp3: ["mp3"],
  mp4: ["mp4", "m4v", "mov"],
  mov: ["mov", "mp4"],
  webm: ["webm"],
  zip: ["zip"],
  "7z": ["7z"],
  rar: ["rar"],
  gz: ["gz"],
  docx: ["docx", "zip"],
  xlsx: ["xlsx", "zip"],
  pptx: ["pptx", "zip"],
  doc: ["cfb"],
  xls: ["cfb"],
  ppt: ["cfb"],
};
const MACRO_EXTS = new Set(["docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppsm"]);
const ACTIVE_CONTENT_EXTS = new Set(["html", "htm", "svg", "xhtml", "js", "mjs", "sh", "py", "rb", "pl", "php"]);
const BIDI_CONTROL = /[‪-‮⁦-⁩‎‏]/;
const EICAR = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export function extOf(name) {
  // Windows silently drops trailing dots/spaces: "evil.exe. " runs as evil.exe
  const trimmed = String(name).replace(/[.\s]+$/, "");
  const i = trimmed.lastIndexOf(".");
  return i > 0 ? trimmed.slice(i + 1).toLowerCase() : "";
}

// Display-safe filename. Bidi control characters are replaced with a visible
// marker so a name like "invoice\u202Efdp.exe" can never render as
// "invoiceexe.pdf" anywhere in the UI, logs or exports.
export function cleanName(name) {
  return String(name || "file")
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, (c) => `[U+${c.codePointAt(0).toString(16).toUpperCase()}]`)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .slice(0, 200) || "file";
}

function sniffExecutable(head) {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return "Windows program (PE/MZ)";
  if (head.length >= 4 && head.readUInt32BE(0) === 0x7f454c46) return "Linux program (ELF)";
  if (head.length >= 4) {
    const m = head.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(m)) return "macOS program (Mach-O)";
  }
  return null;
}

// Minimal ZIP central-directory reader — lists entry names and whether any
// entry is encrypted, without extracting anything.
async function inspectZip(filePath, size) {
  const fh = await fsp.open(filePath, "r");
  try {
    const tailLen = Math.min(size, 65_557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return { readable: false };
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize > 16 * 1024 * 1024) return { readable: false };
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const names = [];
    let encrypted = false;
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      if (flags & 0x1) encrypted = true;
      names.push(cd.toString("utf8", p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { readable: true, names, encrypted };
  } finally {
    await fh.close();
  }
}

function clamScan(filePath) {
  const host = process.env.CLAMAV_HOST;
  if (!host) return Promise.resolve(null);
  const port = Number(process.env.CLAMAV_PORT) || 3310;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let response = "";
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(60_000, () => done({ error: "ClamAV timed out" }));
    socket.on("error", (e) => done({ error: `ClamAV unreachable (${e.code || e.message})` }));
    socket.on("data", (d) => (response += d.toString()));
    socket.on("end", () => {
      const r = response.replace(/\0/g, "").trim();
      if (/OK$/.test(r)) done({ clean: true });
      else if (/FOUND$/.test(r)) done({ clean: false, signature: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else done({ error: `ClamAV: ${r || "no response"}` });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
      stream.on("data", (chunk) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      });
      stream.on("end", () => socket.write(Buffer.alloc(4)));
      stream.on("error", (e) => done({ error: e.message }));
    });
  });
}

/**
 * Inspects a file on disk. Returns { blocked: string[], warnings: string[], sha256, detected }.
 * Pure function of the bytes + name, so it's easy to unit-test.
 */
export async function inspectFile(filePath, originalName) {
  const blocked = [];
  const warnings = [];
  const stat = await fsp.stat(filePath);
  const name = String(originalName || "");
  const ext = extOf(name);

  if (BIDI_CONTROL.test(name)) {
    blocked.push("Filename contains hidden text-direction characters — a trick used to make an .exe look like a .pdf.");
  }
  if (config.blockedExtensions.has(ext)) {
    blocked.push(`.${ext} files can run code on the recipient's computer and are not allowed.`);
  }

  const fh = await fsp.open(filePath, "r");
  const head = Buffer.alloc(Math.min(stat.size, 8192));
  await fh.read(head, 0, head.length, 0);
  await fh.close();

  const exe = sniffExecutable(head);
  if (exe && !config.blockedExtensions.has(ext)) {
    blocked.push(`This is actually a ${exe} disguised as ${ext ? `a .${ext} file` : "a file with no extension"}.`);
  }
  if (head.includes(EICAR)) blocked.push("Matched the EICAR antivirus test signature.");

  const ft = stat.size > 0 ? await fileTypeFromBuffer(head).catch(() => undefined) : undefined;
  const detected = ft?.ext || (exe ? "exe" : null);

  if (EXPECTED[ext] && stat.size > 0) {
    if (!ft) {
      blocked.push(`Doesn't look like a real .${ext} file — its contents don't match the extension.`);
    } else if (!EXPECTED[ext].includes(ft.ext)) {
      blocked.push(`Named .${ext} but the contents are actually ${ft.ext.toUpperCase()}.`);
    }
  }

  if (MACRO_EXTS.has(ext)) warnings.push("Macro-enabled Office file. Only enable macros if you trust the sender.");
  if (ACTIVE_CONTENT_EXTS.has(ext)) warnings.push("Script or web file — can run code if opened in a browser or terminal.");
  if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) warnings.push("Executable script (starts with #!).");

  const isZipFamily = ft?.ext === "zip" || ["docx", "xlsx", "pptx", "zip"].includes(ft?.ext);
  if (isZipFamily) {
    const z = await inspectZip(filePath, stat.size).catch(() => ({ readable: false }));
    if (!z.readable) {
      warnings.push("Archive could not be fully inspected.");
    } else {
      if (z.encrypted) warnings.push("Password-protected archive — its contents can't be scanned. A common malware trick; confirm with the sender.");
      const dangerous = z.names.filter((n) => config.blockedExtensions.has(extOf(n)) || BIDI_CONTROL.test(n));
      if (dangerous.length) {
        blocked.push(`Archive contains executable files: ${dangerous.slice(0, 5).join(", ")}${dangerous.length > 5 ? "…" : ""}`);
      }
      if (["docx", "xlsx", "pptx"].includes(ext) && z.names.some((n) => /vbaProject\.bin$/i.test(n))) {
        warnings.push(`This .${ext} contains macro code, which normal .${ext} files never do.`);
      }
    }
  }

  const digest = await sha256File(filePath);
  const banned = await query("SELECT reason FROM banned_hashes WHERE sha256 = $1", [digest]);
  if (banned.rows[0]) blocked.push(`This exact file was banned by an admin${banned.rows[0].reason ? `: ${banned.rows[0].reason}` : "."}`);

  const clam = await clamScan(filePath);
  if (clam?.clean === false) blocked.push(`Virus scanner flagged it: ${clam.signature}`);
  if (clam?.error) warnings.push(`Not virus-scanned — ${clam.error}.`);

  return { blocked, warnings, sha256: digest, detected, size: stat.size, ext };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    // Never use the client's filename on disk — that's how path traversal happens.
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20 },
});

/**
 * Express middleware: accepts one optional file in `field`, runs File Shield,
 * and either rejects with 422 or stores it and sets req.shieldedFile.
 */
export function shieldUpload(field, context) {
  const single = upload.single(field);
  return (req, res, next) => {
    single(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new HttpError(413, `File is too large. Max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`));
        }
        return next(new HttpError(400, err.message));
      }
      if (!req.file) return next();

      // Multer decodes the multipart filename as latin1; restore UTF-8.
      const rawName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const originalName = cleanName(rawName);
      try {
        // Inspect the raw name (so hidden characters are detected), store the safe one.
        const result = await inspectFile(req.file.path, rawName);
        if (result.blocked.length) {
          await fsp.unlink(req.file.path).catch(() => {});
          await query(
            `INSERT INTO blocked_uploads (user_id, original_name, size_bytes, sha256, reasons, context, ip_address)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [req.user.id, originalName, result.size, result.sha256, JSON.stringify(result.blocked), context, clientIp(req)]
          );
          await audit(req, "file.blocked", {
            targetType: "file",
            targetId: result.sha256.slice(0, 16),
            meta: { name: originalName, reasons: result.blocked, context },
          });
          notifyAdmins(
            {
              type: "security",
              title: `File Shield blocked an upload from ${req.user.name}`,
              body: `${originalName} — ${result.blocked[0]}`,
              link: "/admin/security?tab=files",
            },
            { except: req.user.role === "admin" ? req.user.id : undefined }
          );
          return next(new HttpError(422, `Blocked by File Shield: ${result.blocked[0]}`, { code: "FILE_BLOCKED", reasons: result.blocked }));
        }

        const storageKey = path.basename(req.file.path);
        await fsp.rename(req.file.path, path.join(config.uploadDir, storageKey));
        const { rows } = await query(
          `INSERT INTO files (storage_key, original_name, size_bytes, declared_mime, detected_type, sha256, risk_level, risk_notes, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            storageKey,
            originalName,
            result.size,
            req.file.mimetype,
            result.detected,
            result.sha256,
            result.warnings.length ? "warn" : "clean",
            JSON.stringify(result.warnings),
            req.user.id,
          ]
        );
        req.shieldedFile = rows[0];
        next();
      } catch (e) {
        await fsp.unlink(req.file.path).catch(() => {});
        next(e);
      }
    });
  };
}

export const publicFile = (f) =>
  f && {
    id: f.id,
    name: f.original_name,
    size: Number(f.size_bytes),
    sha256: f.sha256,
    risk_level: f.risk_level,
    risk_notes: f.risk_notes,
    detected_type: f.detected_type,
    created_at: f.created_at,
  };

/**
 * Streams a stored file back as a download, after re-hashing it and checking
 * it still matches the fingerprint taken at upload. A mismatch means the file
 * was changed on disk and is refused.
 */
export async function sendStoredFile(req, res, { file, legacyPath, legacyName }) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  // Always a download, never rendered inline: an uploaded .html/.svg must
  // not be able to run script on our origin.
  const asDownload = (name) => {
    res.attachment(name);
    res.setHeader("Content-Type", "application/octet-stream");
  };

  if (file) {
    const full = path.join(config.uploadDir, path.basename(file.storage_key));
    if (!fs.existsSync(full)) throw new HttpError(410, "This file is no longer on the server.");
    const digest = await sha256File(full);
    if (digest !== file.sha256) {
      await audit(req, "file.integrity_failed", {
        targetType: "file",
        targetId: file.id,
        meta: { name: file.original_name, expected: file.sha256, actual: digest },
      });
      notifyAdmins({
        type: "security",
        title: "A stored file failed its integrity check",
        body: `${file.original_name} no longer matches the fingerprint taken at upload. Download was refused.`,
        link: "/admin/security?tab=audit",
      });
      throw new HttpError(409, "This file was modified after upload and can't be trusted. Admins have been alerted.", { code: "INTEGRITY_FAILED" });
    }
    res.setHeader("X-File-SHA256", file.sha256);
    asDownload(file.original_name);
    return res.sendFile(full);
  }

  if (legacyPath) {
    // Files uploaded before File Shield existed. Make sure the stored path
    // can't point outside the upload directory.
    const resolved = path.resolve(legacyPath);
    const roots = [config.uploadDir, path.resolve("uploads")];
    if (!roots.some((r) => resolved.startsWith(r + path.sep))) throw new HttpError(404, "File not found");
    if (!fs.existsSync(resolved)) throw new HttpError(410, "This file is no longer on the server.");
    asDownload(cleanName(legacyName || path.basename(resolved)));
    return res.sendFile(resolved);
  }

  throw new HttpError(404, "No file attached");
}

export async function deleteStoredFiles(fileRows) {
  for (const f of fileRows) {
    try {
      if (f.storage_key) await fsp.unlink(path.join(config.uploadDir, path.basename(f.storage_key)));
      else if (f.file_path) {
        const resolved = path.resolve(f.file_path);
        if (resolved.startsWith(config.uploadDir + path.sep)) await fsp.unlink(resolved);
      }
    } catch {
      /* already gone */
    }
  }
}
