// End-to-end tests for multi-team features: teams, projects, manager role,
// checklists, links, dependencies, mentions, bulk edits, templates,
// reports, API tokens, profiles, email invites/resets, workspace settings
// (CORS), messaging rules and webhooks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  console.log("TEST_DATABASE_URL not set — skipping workspace tests.");
  process.exit(0);
}
Object.assign(process.env, {
  DATABASE_URL: TEST_DB,
  JWT_SECRET: "test-secret-0123456789-0123456789-0123456789",
  UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "airlock-ws-")),
  CHECK_BREACHED_PASSWORDS: "false",
  LOGIN_RATE_LIMIT: "1000",
  API_RATE_LIMIT: "100000",
  MAIL_TRANSPORT: "log",
  NODE_ENV: "test",
  ALLOW_HTTP_WEBHOOKS: "true",
  ALLOW_PRIVATE_WEBHOOKS: "true",
  FRONTEND_URL: "https://app.example.com",
});

const { pool } = await import("../src/db.js");
const { runMigrations } = await import("../src/migrate.js");
const { hashPassword } = await import("../src/lib/passwords.js");
const { sentMail } = await import("../src/lib/mailer.js");
const { runJobsOnce } = await import("../src/lib/scheduler.js");
const { default: app } = await import("../src/app.js");

let server;
let base;
const S = {};

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
const fileForm = (name, bytes) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes]), name);
  return fd;
};

async function makeUser(name, email, role) {
  const r = await api("POST", "/users", { token: S.admin, body: { name, email, role, send_invite: false } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const l = await api("POST", "/auth/login", { body: { email, password: r.data.temp_password } });
  const c = await api("POST", "/auth/password", { token: l.data.token, body: { current_password: r.data.temp_password, new_password: "Granite-Harbour-Lantern-51" } });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  return { id: r.data.user.id, token: c.data.token };
}

before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations({ log: () => {} });
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Ada Admin','admin@w.test',$1,'admin')`,
    [await hashPassword("Correct-Horse-Battery-9")]
  );
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  S.admin = (await api("POST", "/auth/login", { body: { email: "admin@w.test", password: "Correct-Horse-Battery-9" } })).data.token;
  S.maya = await makeUser("Maya Manager", "maya@w.test", "manager");
  S.dan = await makeUser("Dan Developer", "dan@w.test", "member");
  S.mark = await makeUser("Mark Marketer", "mark@w.test", "member");
  S.olga = await makeUser("Olga Outsider", "olga@w.test", "member");
});

after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

test("teams group people and team leads can manage membership", async () => {
  const eng = await api("POST", "/teams", { token: S.admin, body: { name: "Engineering", lead_id: S.maya.id, member_ids: [S.dan.id], color: "#2f5aa8" } });
  assert.equal(eng.status, 201);
  S.engTeam = eng.data.id;
  const mkt = await api("POST", "/teams", { token: S.admin, body: { name: "Marketing", member_ids: [S.mark.id] } });
  S.mktTeam = mkt.data.id;
  assert.equal((await api("POST", "/teams", { token: S.dan.token, body: { name: "Rogue" } })).status, 403);
  const leadEdit = await api("PATCH", `/teams/${S.engTeam}`, { token: S.maya.token, body: { name: "Renamed" } });
  assert.equal(leadEdit.status, 403, "leads can only change membership");
  const list = await api("GET", "/teams", { token: S.dan.token });
  assert.equal(list.data.find((t) => t.name === "Engineering").members.length, 2);
  const dir = await api("GET", "/users/directory", { token: S.dan.token });
  assert.equal(dir.status, 200);
  assert.ok(dir.data.find((u) => u.id === S.dan.id).teams.some((t) => t.name === "Engineering"));
});

test("managers create projects; tasks get per-project keys", async () => {
  assert.equal((await api("POST", "/projects", { token: S.dan.token, body: { key: "NOPE", name: "Nope" } })).status, 403);
  const web = await api("POST", "/projects", {
    token: S.maya.token,
    body: { key: "web", name: "Website rebuild", kind: "engineering", team_id: S.engTeam },
  });
  assert.equal(web.status, 201, JSON.stringify(web.data));
  assert.equal(web.data.key, "WEB");
  assert.equal(web.data.member_count, 2, "creator + Engineering team");
  S.web = web.data.id;
  const dup = await api("POST", "/projects", { token: S.maya.token, body: { key: "WEB", name: "Again" } });
  assert.equal(dup.status, 409);

  const t1 = await api("POST", "/tasks", { token: S.maya.token, body: { title: "Set up CI pipeline", assigned_to: S.dan.id, project_id: S.web, labels: ["Backend", "ci"], estimate: 5 } });
  assert.equal(t1.status, 201, JSON.stringify(t1.data));
  assert.equal(t1.data.key, "WEB-1");
  assert.deepEqual(t1.data.labels, ["backend", "ci"]);
  const t2 = await api("POST", "/tasks", { token: S.maya.token, body: { title: "Launch blog post for the new site", assigned_to: S.mark.id, project_id: S.web, channel: "Blog", type: "content", checklist: ["Draft", "Edit", "Schedule"] } });
  assert.equal(t2.data.key, "WEB-2");
  assert.equal(t2.data.checklist_total, 3);
  S.t1 = t1.data.id;
  S.t2 = t2.data.id;

  const proj = await api("GET", `/projects/${S.web}`, { token: S.mark.token });
  assert.equal(proj.status, 200, "assignee was added to the project automatically");

  const mktProj = await api("POST", "/projects", { token: S.admin, body: { key: "MKT", name: "Q4 Campaign", kind: "marketing", team_id: S.mktTeam } });
  S.mkt = mktProj.data.id;
  const notMine = await api("POST", "/tasks", { token: S.maya.token, body: { title: "Sneaky task", assigned_to: S.dan.id, project_id: S.mkt } });
  assert.equal(notMine.status, 403, "managers can't add tasks to projects they're not on");
  const mt = await api("POST", "/tasks", { token: S.admin, body: { title: "Write Q4 newsletter", assigned_to: S.mark.id, project_id: S.mkt, due_date: "2030-01-15" } });
  S.mktTask = mt.data.id;
});

test("visibility: project members see project tasks, outsiders don't", async () => {
  assert.equal((await api("GET", `/tasks/${S.t1}`, { token: S.olga.token })).status, 403);
  const danSees = await api("GET", `/tasks/${S.t2}`, { token: S.dan.token });
  assert.equal(danSees.status, 200, "project teammate can see");
  assert.equal(danSees.data.can_manage, false);
  assert.equal((await api("PATCH", `/tasks/${S.t2}`, { token: S.dan.token, body: { title: "hijack" } })).status, 403);
  const list = await api("GET", "/tasks", { token: S.olga.token });
  assert.equal(list.data.length, 0);
  const mayaList = await api("GET", "/tasks", { token: S.maya.token });
  assert.ok(!mayaList.data.some((t) => t.id === S.mktTask), "manager doesn't see other projects");
  const byKey = await api("GET", "/tasks?q=WEB-1", { token: S.dan.token });
  assert.equal(byKey.data.length, 1);
  const byLabel = await api("GET", "/tasks?label=ci", { token: S.maya.token });
  assert.equal(byLabel.data.length, 1);
});

test("checklists, links and dependencies", async () => {
  const item = await api("POST", `/tasks/${S.t1}/checklist`, { token: S.dan.token, body: { text: "Add lint step" } });
  assert.equal(item.status, 201);
  const done = await api("PATCH", `/tasks/${S.t1}/checklist/${item.data.id}`, { token: S.dan.token, body: { done: true } });
  assert.equal(done.data.done, true);
  assert.equal((await api("POST", `/tasks/${S.t1}/checklist`, { token: S.olga.token, body: { text: "x" } })).status, 403);

  const link = await api("POST", `/tasks/${S.t1}/links`, { token: S.dan.token, body: { url: "https://github.com/acme/web/pull/42" } });
  assert.equal(link.data.kind, "github_pr");
  assert.equal((await api("POST", `/tasks/${S.t1}/links`, { token: S.dan.token, body: { url: "javascript:alert(1)" } })).status, 400);

  const dep = await api("POST", `/tasks/${S.t2}/dependencies`, { token: S.maya.token, body: { depends_on: "WEB-1" } });
  assert.equal(dep.status, 201);
  const loop = await api("POST", `/tasks/${S.t1}/dependencies`, { token: S.maya.token, body: { depends_on: "WEB-2" } });
  assert.equal(loop.status, 409);
  const detail = await api("GET", `/tasks/${S.t2}`, { token: S.mark.token });
  assert.equal(detail.data.is_blocked, true);
  assert.equal(detail.data.depends_on[0].key, "WEB-1");
  const t1 = await api("GET", `/tasks/${S.t1}`, { token: S.dan.token });
  assert.equal(t1.data.checklist_done, 1);
  assert.equal(t1.data.blocks[0].key, "WEB-2");
});

test("@mentions notify only people who can see the task", async () => {
  await api("POST", `/tasks/${S.t1}/comments`, { token: S.dan.token, body: { message: "@Maya @Olga can you check the runner config?", mentions: [S.maya.id, S.olga.id] } });
  const maya = await api("GET", "/notifications", { token: S.maya.token });
  assert.ok(maya.data.items.some((n) => n.type === "mention"));
  const olga = await api("GET", "/notifications", { token: S.olga.token });
  assert.ok(!olga.data.items.some((n) => n.type === "mention"), "no leak to people outside the project");
});

test("bulk edits only touch tasks the caller manages", async () => {
  const r = await api("POST", "/tasks/bulk", { token: S.maya.token, body: { ids: [S.t1, S.mktTask], action: "priority", value: "urgent" } });
  assert.deepEqual(r.data, { updated: 1, skipped: 1 });
  const lbl = await api("POST", "/tasks/bulk", { token: S.maya.token, body: { ids: [S.t1, S.t2], action: "add_label", value: "Sprint 12" } });
  assert.equal(lbl.data.updated, 2);
  const t = await api("GET", `/tasks/${S.t2}`, { token: S.maya.token });
  assert.ok(t.data.labels.includes("sprint-12"));
  assert.equal((await api("POST", "/tasks/bulk", { token: S.dan.token, body: { ids: [S.t1], action: "close" } })).status, 403);
});

test("templates and recurring tasks", async () => {
  const tpl = await api("POST", `/projects/${S.web}/templates`, {
    token: S.maya.token,
    body: { title: "Weekly dependency updates", assignee_id: S.dan.id, recurrence: "weekly", checklist: ["Run npm outdated", "Open PR"], labels: ["maintenance"] },
  });
  assert.equal(tpl.status, 201, JSON.stringify(tpl.data));
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(tpl.data.next_run_on, iso);

  const run = await runJobsOnce();
  assert.equal(run.created, 1);
  const again = await runJobsOnce();
  assert.equal(again.created, 0, "doesn't run twice the same day");
  const { rows } = await pool.query(`SELECT next_run_on FROM task_templates WHERE id = $1`, [tpl.data.id]);
  assert.ok(rows[0].next_run_on > iso, "advanced to next week");
  const made = await api("GET", "/tasks?label=maintenance", { token: S.dan.token });
  assert.equal(made.data.length, 1);
  assert.equal(made.data[0].checklist_total, 2);

  const manual = await api("POST", `/projects/${S.web}/templates/${tpl.data.id}/run`, { token: S.maya.token, body: {} });
  assert.equal(manual.status, 201);
  assert.equal((await api("POST", `/projects/${S.web}/templates`, { token: S.dan.token, body: { title: "nope" } })).status, 403);
});

test("reports are scoped and limited to leads", async () => {
  await api("POST", `/tasks/${S.t1}/start`, { token: S.dan.token });
  const fd = new FormData();
  fd.append("notes", "CI is green");
  await api("POST", `/tasks/${S.t1}/submit`, { token: S.dan.token, form: fd });
  const rev = await api("POST", `/tasks/${S.t1}/review`, { token: S.maya.token, body: { decision: "approve" } });
  assert.equal(rev.data.status, "completed");
  const r = await api("GET", `/reports/delivery?project=${S.web}&weeks=6`, { token: S.maya.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.weekly.length, 6);
  assert.equal(r.data.summary.completed, 1);
  assert.equal((await api("GET", "/reports/delivery", { token: S.dan.token })).status, 403);
  const ov = await api("GET", "/reports/overview", { token: S.maya.token });
  assert.equal(ov.data.security, null, "managers don't see security posture");
  assert.ok(!ov.data.projects.some((p) => p.key === "MKT"));
});

test("search respects visibility", async () => {
  const dan = await api("GET", "/search?q=WEB-1", { token: S.dan.token });
  assert.equal(dan.data.tasks.length, 1);
  const olga = await api("GET", "/search?q=WEB-1", { token: S.olga.token });
  assert.equal(olga.data.tasks.length, 0);
  const proj = await api("GET", "/search?q=website", { token: S.dan.token });
  assert.equal(proj.data.projects[0].key, "WEB");
});

test("personal API tokens: scopes, revocation, no account changes", async () => {
  const ro = await api("POST", "/me/tokens", { token: S.dan.token, body: { name: "CI reader", scope: "read" } });
  assert.equal(ro.status, 201);
  assert.match(ro.data.token, /^alk_/);
  const list = await api("GET", "/tasks", { token: ro.data.token });
  assert.equal(list.status, 200);
  assert.equal((await api("POST", `/tasks/${S.t1}/comments`, { token: ro.data.token, body: { message: "hi" } })).status, 403);

  const rw = await api("POST", "/me/tokens", { token: S.dan.token, body: { name: "Bot", scope: "write" } });
  assert.equal((await api("POST", `/tasks/${S.t1}/comments`, { token: rw.data.token, body: { message: "Deployed from CI" } })).status, 201);
  assert.equal((await api("POST", "/auth/password", { token: rw.data.token, body: { current_password: "x", new_password: "y" } })).status, 403);
  assert.equal((await api("POST", "/me/tokens", { token: rw.data.token, body: { name: "chain" } })).status, 403);

  await api("DELETE", `/me/tokens/${rw.data.id}`, { token: S.dan.token });
  assert.equal((await api("GET", "/tasks", { token: rw.data.token })).status, 401);
  const mine = await api("GET", "/me/tokens", { token: S.dan.token });
  assert.ok(!JSON.stringify(mine.data).includes(ro.data.token), "raw tokens are never returned again");
});

test("profile, timezone validation and avatars", async () => {
  const r = await api("PATCH", "/me", { token: S.dan.token, body: { title: "Backend engineer", timezone: "Asia/Karachi", notify_prefs: { email_review: false } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.title, "Backend engineer");
  assert.equal(r.data.user.notify_prefs.email_review, false);
  assert.equal(r.data.user.notify_prefs.email_assigned, true);
  assert.equal((await api("PATCH", "/me", { token: S.dan.token, body: { timezone: "Mars/Olympus" } })).status, 400);

  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const up = await api("POST", "/me/avatar", { token: S.dan.token, form: fileForm("me.png", png) });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const img = await fetch(base + up.data.user.avatar_url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  const svg = await api("POST", "/me/avatar", { token: S.dan.token, form: fileForm("x.svg", "<svg onload=alert(1)>") });
  assert.equal(svg.status, 400);
  const fake = await api("POST", "/me/avatar", { token: S.dan.token, form: fileForm("x.png", "not a png") });
  assert.equal(fake.status, 422);
  const exp = await api("GET", "/me/export", { token: S.dan.token });
  assert.equal(exp.status, 200);
  assert.ok(Array.isArray(exp.data.tasks));
});

test("email invites and self-service password reset", async () => {
  const inv = await api("POST", "/users", { token: S.admin, body: { name: "Ivy Invitee", email: "ivy@w.test", role: "member", team_ids: [S.mktTeam] } });
  assert.equal(inv.status, 201);
  assert.equal(inv.data.invited, true);
  assert.equal(inv.data.temp_password, undefined);
  const mail = sentMail.findLast((m) => m.to === "ivy@w.test");
  const token = mail.text.match(/token=([\w-]+)/)[1];
  const info = await api("GET", `/auth/token-info?token=${token}`);
  assert.equal(info.data.purpose, "invite");
  const set = await api("POST", "/auth/reset", { body: { token, password: "Saffron-Window-Kettle-3" } });
  assert.equal(set.status, 200);
  const reuse = await api("POST", "/auth/reset", { body: { token, password: "Another-Lovely-Phrase-4" } });
  assert.equal(reuse.status, 400);
  const login = await api("POST", "/auth/login", { body: { email: "ivy@w.test", password: "Saffron-Window-Kettle-3" } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.must_change_password, false);

  const unknown = await api("POST", "/auth/forgot", { body: { email: "nobody@w.test" } });
  assert.equal(unknown.status, 200, "same answer for unknown emails");
  await api("POST", "/auth/forgot", { body: { email: "ivy@w.test" } });
  await new Promise((r) => setTimeout(r, 300));
  const resetMail = sentMail.findLast((m) => m.to === "ivy@w.test" && /Reset/.test(m.subject));
  const rt = resetMail.text.match(/token=([\w-]+)/)[1];
  assert.equal((await api("POST", "/auth/reset", { body: { token: rt, password: "short" } })).status, 400);
  assert.equal((await api("POST", "/auth/reset", { body: { token: rt, password: "Velvet-Comet-Orchard-8" } })).status, 200);
  assert.equal((await api("GET", "/auth/me", { token: login.data.token })).status, 401, "old sessions end after a reset");
});

test("workspace settings drive CORS and validate origins", async () => {
  const bad = await api("PATCH", "/admin/settings", { token: S.admin, body: { extra_origins: ["https://evil.com/path"] } });
  assert.equal(bad.status, 400);
  const ok = await api("PATCH", "/admin/settings", { token: S.admin, body: { extra_origins: ["https://staging.example.com/"], workspace_name: "Acme Studio" } });
  assert.deepEqual(ok.data.extra_origins, ["https://staging.example.com"]);
  const pre = (origin) => fetch(base + "/tasks", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } });
  assert.equal((await pre("https://staging.example.com")).headers.get("access-control-allow-origin"), "https://staging.example.com");
  assert.equal((await pre("https://app.example.com")).headers.get("access-control-allow-origin"), "https://app.example.com");
  assert.equal((await pre("https://evil.example")).headers.get("access-control-allow-origin"), null);
  assert.equal((await api("GET", "/auth/config")).data.workspace_name, "Acme Studio");
  assert.equal((await api("PATCH", "/admin/settings", { token: S.maya.token, body: { member_dm: "all" } })).status, 403);
});

test("member-to-member messaging follows the workspace setting", async () => {
  const say = (from, to) => {
    const fd = new FormData();
    fd.append("message", "hey");
    return api("POST", `/messages/${to}`, { token: from, form: fd });
  };
  assert.equal((await say(S.dan.token, S.mark.id)).status, 201, "default 'team': they share project WEB");
  assert.equal((await say(S.dan.token, S.olga.id)).status, 403, "no shared team or project");
  await api("PATCH", "/admin/settings", { token: S.admin, body: { member_dm: "off" } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await say(S.dan.token, S.mark.id)).status, 403);
  assert.equal((await say(S.dan.token, S.maya.id)).status, 201, "members can always reach managers");
  await api("PATCH", "/admin/settings", { token: S.admin, body: { member_dm: "team" } });
});

test("webhooks are signed, filtered by event, and SSRF-guarded", async () => {
  const received = [];
  const hook = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.end("ok");
    });
  });
  await new Promise((r) => hook.listen(0, r));
  const url = `http://127.0.0.1:${hook.address().port}/hook`;

  const created = await api("POST", "/integrations/webhooks", { token: S.admin, body: { name: "CI", url, format: "json", events: ["task.created"] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(created.data.secret, /^[0-9a-f]{48}$/);
  assert.equal(created.data.url_enc, undefined);

  await api("POST", "/tasks", { token: S.admin, body: { title: "Webhook me", assigned_to: S.mark.id, project_id: S.mkt } });
  for (let i = 0; i < 40 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(received.length, 1);
  const { headers, body } = received[0];
  const expected = crypto.createHmac("sha256", created.data.secret).update(`${headers["x-airlock-timestamp"]}.${body}`).digest("hex");
  assert.equal(headers["x-airlock-signature"], `sha256=${expected}`);
  assert.equal(JSON.parse(body).event, "task.created");

  assert.equal((await api("POST", "/integrations/webhooks", { token: S.maya.token, body: { name: "x", url, events: ["task.created"] } })).status, 403);
  process.env.ALLOW_PRIVATE_WEBHOOKS = "false";
  const ssrf = await api("POST", "/integrations/webhooks", { token: S.admin, body: { name: "meta", url: "http://169.254.169.254/latest", events: ["task.created"] } });
  assert.equal(ssrf.status, 400);
  assert.match(ssrf.data.error, /private|internal/);
  process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
  hook.close();
});

test("audit chain is still intact after all of the above", async () => {
  const v = await api("POST", "/admin/audit/verify", { token: S.admin });
  assert.equal(v.data.ok, true);
});
