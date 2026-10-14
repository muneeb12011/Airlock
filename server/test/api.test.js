// End-to-end API tests against a real PostgreSQL database.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/airlock_test npm test
//
// The test database is wiped at the start of the run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.log("TEST_DATABASE_URL not set — skipping API tests.");
  process.exit(0);
}
process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = "test-secret-0123456789-0123456789-0123456789";
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "airlock-test-"));
process.env.CHECK_BREACHED_PASSWORDS = "false";
process.env.LOGIN_RATE_LIMIT = "1000";
process.env.API_RATE_LIMIT = "100000";
process.env.MAIL_TRANSPORT = "log";
process.env.NODE_ENV = "test";
process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
process.env.ALLOW_HTTP_WEBHOOKS = "true";

const { pool } = await import("../src/db.js");
const { runMigrations } = await import("../src/migrate.js");
const { config } = await import("../src/config.js");
const { codeAt, currentStep } = await import("../src/lib/totp.js");
const { hashPassword } = await import("../src/lib/passwords.js");
const http = await import("http");
const { default: app } = await import("../src/app.js");
const { initSocket } = await import("../src/socket.js");
const { io: ioClient } = await import("socket.io-client");

let server;
let base;

async function api(method, url, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers: h, body: payload });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

function fileForm(name, bytes, extra = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  fd.append("file", new Blob([bytes]), name);
  return fd;
}

function makeZip(entries, { encrypted = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const nameBuf = Buffer.from(name);
    const crc = zlib.crc32(data);
    const flags = encrypted ? 1 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data);
    centrals.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations({ log: () => {} });
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES ('Ada Admin','admin@t.test',$1,'admin',true)`,
    [await hashPassword("Temp-Admin-Pass-1")]
  );
  server = http.createServer(app);
  initSocket(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

const S = {}; // shared state across ordered tests

test("first login forces a password change", async () => {
  const login = await api("POST", "/auth/login", { body: { email: "ADMIN@t.test", password: "Temp-Admin-Pass-1" } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.must_change_password, true);
  const blocked = await api("GET", "/tasks", { token: login.data.token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, "SETUP_REQUIRED");

  const weak = await api("POST", "/auth/password", { token: login.data.token, body: { current_password: "Temp-Admin-Pass-1", new_password: "short" } });
  assert.equal(weak.status, 400);

  const ok = await api("POST", "/auth/password", { token: login.data.token, body: { current_password: "Temp-Admin-Pass-1", new_password: "Correct-Horse-Battery-9" } });
  assert.equal(ok.status, 200);
  S.admin = ok.data.token;

  const old = await api("GET", "/auth/me", { token: login.data.token });
  assert.equal(old.status, 401, "old session is revoked after password change");
});

test("admin creates a member with a one-time password", async () => {
  const r = await api("POST", "/users", { token: S.admin, body: { name: "Bilal Member", email: "bilal@t.test", send_invite: false } });
  assert.equal(r.status, 201);
  assert.match(r.data.temp_password, /^\w{4}-\w{4}-\w{4}-\w{4}$/);
  S.memberId = r.data.user.id;
  const l = await api("POST", "/auth/login", { body: { email: "bilal@t.test", password: r.data.temp_password } });
  const c = await api("POST", "/auth/password", { token: l.data.token, body: { current_password: r.data.temp_password, new_password: "Member-Strong-Pass-7" } });
  assert.equal(c.status, 200);
  S.member = c.data.token;

  const r2 = await api("POST", "/users", { token: S.admin, body: { name: "Sara Member", email: "sara@t.test", send_invite: false } });
  const l2 = await api("POST", "/auth/login", { body: { email: "sara@t.test", password: r2.data.temp_password } });
  const c2 = await api("POST", "/auth/password", { token: l2.data.token, body: { current_password: r2.data.temp_password, new_password: "Orchid-Lantern-Pass-8" } });
  S.member2 = c2.data.token;
  S.member2Id = r2.data.user.id;

  const dup = await api("POST", "/users", { token: S.admin, body: { name: "Dup", email: "BILAL@t.test" } });
  assert.equal(dup.status, 409);
});

test("members cannot reach admin routes", async () => {
  assert.equal((await api("GET", "/users", { token: S.member })).status, 403);
  assert.equal((await api("GET", "/reports/overview", { token: S.member })).status, 403);
  assert.equal((await api("POST", "/tasks", { token: S.member, body: { title: "x", assigned_to: 1 } })).status, 403);
});

test("task review workflow with File Shield fingerprinting", async () => {
  const t = await api("POST", "/tasks", {
    token: S.admin,
    body: { title: "Ship the onboarding flow", assigned_to: S.memberId, priority: "high", type: "feature", due_date: "2020-01-01" },
  });
  assert.equal(t.status, 201);
  assert.equal(t.data.is_overdue, true);
  S.taskId = t.data.id;

  const other = await api("GET", `/tasks/${S.taskId}`, { token: S.member2 });
  assert.equal(other.status, 403, "another member can't see it");

  const list = await api("GET", "/tasks", { token: S.member });
  assert.equal(list.data.length, 1);

  const st = await api("POST", `/tasks/${S.taskId}/start`, { token: S.member });
  assert.equal(st.data.status, "in_progress", JSON.stringify(st.data));

  const sub = await api("POST", `/tasks/${S.taskId}/submit`, { token: S.member, form: fileForm("notes.txt", "hello world", { notes: "First pass" }) });
  assert.equal(sub.status, 201, JSON.stringify(sub.data));
  assert.equal(sub.data.status, "in_review");

  const again = await api("POST", `/tasks/${S.taskId}/submit`, { token: S.member, form: fileForm("x.txt", "x") });
  assert.equal(again.status, 409);

  const noNote = await api("POST", `/tasks/${S.taskId}/review`, { token: S.admin, body: { decision: "changes" } });
  assert.equal(noNote.status, 400);
  const changes = await api("POST", `/tasks/${S.taskId}/review`, { token: S.admin, body: { decision: "changes", note: "Add tests" } });
  assert.equal(changes.data.status, "in_progress", JSON.stringify(changes.data));

  const sub2 = await api("POST", `/tasks/${S.taskId}/submit`, { token: S.member, form: fileForm("final.txt", "final deliverable", { notes: "Tests added" }) });
  assert.equal(sub2.status, 201);
  const approve = await api("POST", `/tasks/${S.taskId}/review`, { token: S.admin, body: { decision: "approve", note: "Great" } });
  assert.equal(approve.data.status, "completed");

  const detail = await api("GET", `/tasks/${S.taskId}`, { token: S.admin });
  assert.equal(detail.data.submissions.length, 2);
  const latest = detail.data.submissions[0];
  assert.equal(latest.review_status, "approved");
  assert.equal(latest.file.sha256.length, 64);
  S.submissionId = latest.id;
  S.fileSha = latest.file.sha256;

  const dl = await api("GET", `/admin/submissions/${S.submissionId}/file`, { token: S.admin });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("x-file-sha256"), S.fileSha);
  assert.equal(dl.headers.get("content-type"), "application/octet-stream");
  assert.equal(dl.data.toString(), "final deliverable");

  const pdf = await api("GET", `/admin/tasks/${S.taskId}/export?format=pdf`, { token: S.admin });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");
  const docx = await api("GET", `/admin/tasks/${S.taskId}/export?format=docx`, { token: S.admin });
  assert.equal(docx.data.subarray(0, 2).toString(), "PK");

  const patch = await api("PATCH", `/tasks/${S.taskId}`, { token: S.admin, body: { title: "Ship the onboarding flow v2" } });
  assert.equal(patch.data.priority, "high", "PATCH must not reset fields that weren't sent");
  assert.equal(patch.data.type, "feature");
});

test("members can't set arbitrary statuses", async () => {
  const t = await api("POST", "/tasks", { token: S.admin, body: { title: "Status guard", assigned_to: S.memberId } });
  const r = await api("POST", `/tasks/${t.data.id}/review`, { token: S.member, body: { decision: "approve" } });
  assert.equal(r.status, 403);
  S.openTaskId = t.data.id;
});

test("File Shield blocks disguised and dangerous files", async () => {
  const cases = [
    ["invoice.pdf", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]), /Windows program/],
    ["invoice‮fdp.exe", Buffer.from("hi"), /text-direction/],
    ["setup.exe", Buffer.from("hello"), /\.exe files/],
    ["photo.png", Buffer.from("this is not an image"), /contents don't match|Doesn't look like/],
    ["photo.png", Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj"), /actually PDF/],
    ["eicar.txt", Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"), /EICAR/],
    ["bundle.zip", makeZip([["readme.txt", "hi"], ["payload.exe", "MZ"]]), /Archive contains executable/],
    ["sneaky.exe. ", Buffer.from("x"), /\.exe files/],
  ];
  for (const [name, bytes, expected] of cases) {
    const r = await api("POST", `/messages/${1}`, { token: S.member, form: fileForm(name, bytes) });
    assert.equal(r.status, 422, `${JSON.stringify(name)} should be blocked, got ${r.status} ${JSON.stringify(r.data)}`);
    assert.equal(r.data.code, "FILE_BLOCKED");
    assert.match(r.data.reasons.join(" "), expected, name);
  }
  const blocked = await api("GET", "/admin/files/blocked", { token: S.admin });
  assert.ok(blocked.data.length >= cases.length);
  assert.ok(blocked.data.some((b) => b.original_name === "invoice[U+202E]fdp.exe"), "bidi characters are neutralised for display");
  const left = fs.readdirSync(path.join(config.uploadDir, ".incoming"));
  assert.equal(left.length, 0, "blocked files are deleted from disk");
});

test("File Shield allows real files and warns on risky ones", async () => {
  const png = await api("POST", `/messages/1`, { token: S.member, form: fileForm("ok.png", PNG) });
  assert.equal(png.status, 201, JSON.stringify(png.data));
  assert.equal(png.data.file.risk_level, "clean");

  const macro = await api("POST", `/messages/1`, { token: S.member, form: fileForm("budget.xlsm", makeZip([["a.xml", "<x/>"]])) });
  assert.equal(macro.status, 201);
  assert.equal(macro.data.file.risk_level, "warn");
  assert.match(macro.data.file.risk_notes.join(" "), /Macro/);

  const locked = await api("POST", `/messages/1`, { token: S.member, form: fileForm("secret.zip", makeZip([["a.txt", "x"]], { encrypted: true })) });
  assert.equal(locked.status, 201);
  assert.match(locked.data.file.risk_notes.join(" "), /Password-protected/);
});

test("admins can ban a file by fingerprint", async () => {
  const bytes = Buffer.from("known-bad-payload-v1");
  const first = await api("POST", `/messages/1`, { token: S.member, form: fileForm("tool.txt", bytes) });
  assert.equal(first.status, 201);
  const ban = await api("POST", "/admin/files/bans", { token: S.admin, body: { sha256: first.data.file.sha256, reason: "Leaked internal tool" } });
  assert.equal(ban.status, 201);
  const second = await api("POST", `/messages/1`, { token: S.member, form: fileForm("renamed.txt", bytes) });
  assert.equal(second.status, 422);
  assert.match(second.data.error, /banned/);
});

test("tampered files are refused on download", async () => {
  const { rows } = await pool.query(`SELECT storage_key FROM files WHERE sha256 = $1`, [S.fileSha]);
  fs.appendFileSync(path.join(config.uploadDir, rows[0].storage_key), " + backdoor");
  const dl = await api("GET", `/admin/submissions/${S.submissionId}/file`, { token: S.admin });
  assert.equal(dl.status, 409);
  assert.equal(dl.data.code, "INTEGRITY_FAILED");
});

test("messaging rules, unread counts and realtime delivery", async () => {
  const toMember = await api("POST", `/messages/${S.member2Id}`, { token: S.member, form: fileForm("x.txt", "x") });
  assert.equal(toMember.status, 403, "members can't message each other");

  const sock = ioClient(base, { auth: { token: S.member2 }, transports: ["websocket"] });
  await new Promise((r) => sock.on("connect", r));
  const got = new Promise((r) => sock.on("message:new", r));
  const fd = new FormData();
  fd.append("message", "Hi Sara, quick question");
  const sent = await api("POST", `/messages/${S.member2Id}`, { token: S.admin, form: fd });
  assert.equal(sent.status, 201);
  const live = await got;
  assert.equal(live.message, "Hi Sara, quick question");

  const unread = await api("GET", "/messages/unread-count", { token: S.member2 });
  assert.equal(unread.data.count, 1);
  const thread = await api("GET", "/messages/1", { token: S.member2 });
  assert.equal(thread.data.messages.length, 1);
  assert.equal((await api("GET", "/messages/unread-count", { token: S.member2 })).data.count, 0);

  const bad = ioClient(base, { auth: { token: "garbage" }, transports: ["websocket"] });
  const err = await new Promise((r) => bad.on("connect_error", r));
  assert.equal(err.message, "unauthorized");
  bad.close();
  sock.close();
});

test("account locks after repeated wrong passwords", async () => {
  for (let i = 0; i < config.lockout.maxAttempts; i++) {
    const r = await api("POST", "/auth/login", { body: { email: "sara@t.test", password: "wrong-password" } });
    assert.equal(r.status, 401);
  }
  const locked = await api("POST", "/auth/login", { body: { email: "sara@t.test", password: "Orchid-Lantern-Pass-8" } });
  assert.equal(locked.status, 423);
  const unlock = await api("POST", `/users/${S.member2Id}/unlock`, { token: S.admin });
  assert.equal(unlock.status, 200);
  const ok = await api("POST", "/auth/login", { body: { email: "sara@t.test", password: "Orchid-Lantern-Pass-8" } });
  assert.equal(ok.status, 200);
  const unknown = await api("POST", "/auth/login", { body: { email: "nobody@t.test", password: "whatever" } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, "Wrong email or password.");
});

test("two-factor enrolment, login and recovery codes", async () => {
  const setup = await api("POST", "/auth/2fa/setup", { token: S.member });
  assert.match(setup.data.qr, /^data:image\/png;base64,/);
  const wrong = await api("POST", "/auth/2fa/enable", { token: S.member, body: { code: "000000" } });
  assert.equal(wrong.status, 400);
  const en = await api("POST", "/auth/2fa/enable", { token: S.member, body: { code: codeAt(setup.data.secret, currentStep()) } });
  assert.equal(en.status, 200);
  assert.equal(en.data.recovery_codes.length, 10);
  S.member = en.data.token;

  const step1 = await api("POST", "/auth/login", { body: { email: "bilal@t.test", password: "Member-Strong-Pass-7" } });
  assert.equal(step1.data.mfa_required, true);
  assert.equal(step1.data.token, undefined, "no session before the second factor");

  const replay = codeAt(setup.data.secret, currentStep());
  const v = await api("POST", "/auth/login/verify", { body: { mfa_token: step1.data.mfa_token, code: replay } });
  assert.equal(v.status, 401, "a code already used to enable 2FA can't be replayed");

  const rc = en.data.recovery_codes[0];
  const viaRecovery = await api("POST", "/auth/login/verify", { body: { mfa_token: step1.data.mfa_token, recovery_code: rc.toUpperCase() } });
  assert.equal(viaRecovery.status, 200);
  const reuse = await api("POST", "/auth/login/verify", { body: { mfa_token: step1.data.mfa_token, recovery_code: rc } });
  assert.equal(reuse.status, 401, "recovery codes are single-use");
  S.member = viaRecovery.data.token;
});

test("enforcing 2FA requires the admin to have it first, then gates members", async () => {
  const r = await api("PATCH", "/admin/settings", { token: S.admin, body: { enforce_2fa: true } });
  assert.equal(r.status, 400);

  const setup = await api("POST", "/auth/2fa/setup", { token: S.admin });
  const en = await api("POST", "/auth/2fa/enable", { token: S.admin, body: { code: codeAt(setup.data.secret, currentStep()) } });
  S.admin = en.data.token;
  const ok = await api("PATCH", "/admin/settings", { token: S.admin, body: { enforce_2fa: true } });
  assert.equal(ok.data.enforce_2fa, true);

  const sara = await api("POST", "/auth/login", { body: { email: "sara@t.test", password: "Orchid-Lantern-Pass-8" } });
  const gated = await api("GET", "/tasks", { token: sara.data.token });
  assert.equal(gated.status, 403);
  assert.equal(gated.data.must_enroll_2fa, true);
  await api("PATCH", "/admin/settings", { token: S.admin, body: { enforce_2fa: false } });
});

test("admin export routes honour the IP allowlist and can't be spoofed", async () => {
  config.adminAllowedIps.push("203.0.113.50");
  const r = await api("GET", `/admin/tasks/${S.taskId}/export`, { token: S.admin, headers: { "X-Forwarded-For": "203.0.113.50" } });
  assert.equal(r.status, 403, "X-Forwarded-For must not be trusted with TRUST_PROXY=0");
  assert.equal(r.data.code, "IP_NOT_ALLOWED");
  config.adminAllowedIps.length = 0;
});

test("audit log is hash-chained and detects tampering", async () => {
  const ok = await api("POST", "/admin/audit/verify", { token: S.admin });
  assert.equal(ok.data.ok, true);
  assert.ok(ok.data.checked > 10);

  const edit = await pool.query(`UPDATE audit_log SET actor_name = 'someone else' WHERE id = 3`).catch((e) => e);
  assert.match(String(edit.message), /append-only/, "DB trigger blocks edits");

  // Simulate an attacker with superuser access who bypasses the trigger.
  await pool.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update`);
  await pool.query(`UPDATE audit_log SET meta = '{"title":"rewritten"}' WHERE id = 5`);
  await pool.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update`);
  const bad = await api("POST", "/admin/audit/verify", { token: S.admin });
  assert.equal(bad.data.ok, false);
  assert.equal(Number(bad.data.brokenAt), 5);
});

test("deleting a member removes their tasks, messages and files", async () => {
  const before = fs.readdirSync(config.uploadDir).filter((f) => !f.startsWith(".")).length;
  const r = await api("DELETE", `/users/${S.memberId}`, { token: S.admin });
  assert.equal(r.status, 200);
  const after = fs.readdirSync(config.uploadDir).filter((f) => !f.startsWith(".")).length;
  assert.ok(after < before, "files removed from disk");
  const tasks = await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE assigned_to = $1`, [S.memberId]);
  assert.equal(tasks.rows[0].n, 0);
  const gone = await api("GET", "/auth/me", { token: S.member });
  assert.equal(gone.status, 401, "deleted user's session stops working immediately");

  const self = await api("DELETE", `/users/1`, { token: S.admin });
  assert.equal(self.status, 400);
});

test("overview and CSV export work", async () => {
  const o = await api("GET", "/reports/overview", { token: S.admin });
  assert.equal(o.status, 200);
  assert.ok("security" in o.data && "workload" in o.data);
  const csv = await api("GET", "/admin/tasks.csv", { token: S.admin });
  assert.equal(csv.status, 200);
});
