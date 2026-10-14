<div align="center">

# 🔒 Airlock

**A secure work hub for teams of any size (marketing, engineering, design, ops): projects, tasks, reviews, messages and files. Every file is inspected, every sign-in is checked, and every action goes on a record that shows if anyone tampers with it.**

[![Node](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](#)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](#)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-4169E1?logo=postgresql&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](#)
[![Socket.io](https://img.shields.io/badge/Socket.io-realtime-010101?logo=socketdotio&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

</div>

---

## The problem it solves

Small teams pass work and files around on chat apps and email, and three things keep going wrong:

1. **Accounts get taken over.** Stolen and reused passwords are the most common way attackers get in. Most small-team tools offer a password and nothing else.
2. **Malware arrives looking like normal work.** A program renamed `invoice.pdf`, or a filename like `invoice‮fdp.exe` that uses a hidden right-to-left character so it *displays* as `invoiceexe.pdf`. A password-protected zip that scanners can't open. A Word file carrying macros.
3. **Nobody can prove what happened.** Who downloaded the deliverable? Was the file changed after it was sent? Has anyone quietly edited the logs?

Airlock deals with all three in the place where the work already happens.

## What's inside

### 🏢 Built for big teams
- **Three roles.**
  - **Admins** run the workspace.
  - **Managers** run projects: they create, assign and review work, and see reports for their projects.
  - **Members** work on their own tasks and see their projects' boards.
- **Teams** like Marketing, Engineering and Design, each with a lead. Add a whole team to a project in one click. Team leads manage their own membership.
- **Projects** with a key, so tasks get references like `WEB-42` or `WIN-7`. A project has a goal, dates, kind, colour, members, progress, archiving, and its own board, list and calendar.
- **Visibility follows membership.** People see their own tasks plus everything in projects they belong to, and nothing else. This is enforced in SQL, not just hidden in the UI.
- **Bulk edits** for leads: change priority, reassign, set due dates, add or remove labels, move to another project, close or delete. Tasks you don't manage are skipped, never changed.
- **Reports**: throughput, cycle time, on-time rate, review rounds, work by type and label, and per-person delivery, always limited to what the viewer manages.
- A **⌘K / Ctrl+K command palette** that jumps to any task (including by key), project, person or page.

### 📣 For marketing teams
- **Content calendar**: a month view of every task by publish date, coloured by project. Double-click a day to schedule something new.
- **Channels** (Blog, Email, Instagram, LinkedIn, Ads…), configurable per workspace and shown on cards and the calendar.
- **Recurring tasks** from templates: a weekly newsletter, a monthly report, or a daily social post is created automatically, with its checklist, assignee and due date.
- **Approval flow**: submit, then approve or request changes, with full history and exports for the client.

### 🛠 For developer teams
- **Story points**, labels (`backend`, `bug`, `sprint-12`), and **dependencies**: "WEB-12 waits on WEB-9", with cycle detection and a *Blocked* badge.
- **Checklists** (subtasks) with progress on every card.
- **Links** that recognise GitHub PRs, issues and commits, GitLab MRs, Figma, Google Docs, Notion and preview deploys.
- **Personal API tokens** (`alk_…`): read-only or read-write, set to expire, revocable, with last-used IP shown. They can never change passwords, 2FA or other tokens. Use them from CI to comment on a task when a deploy lands.
- **Signed webhooks**: HMAC-SHA256 over `timestamp.body`. Native **Slack** and **Discord** formats are also available.

### 💬 Collaboration
- **@mentions** in task comments with autocomplete. Only people who can see the task are notified, so a mention never leaks it.
- Real-time chat. Who can message whom is a workspace setting: leads only, people who share a team or project, or everyone.
- **Email notifications** you choose per type (assigned, reviews, mentions, security), plus daily reminders when a task is due tomorrow or became overdue.

### 👤 Profiles & accounts
- Profile photo (images only, checked by File Shield), job title, time zone (teammates see your local time), bio and notification preferences.
- **Email invites** with a set-your-password link, and **self-service forgot-password**. Links work once, expire, and are stored hashed. Without SMTP, the app falls back to one-time passwords.
- **Download my data** as JSON.

### ⚙️ Workspace settings
- Workspace name, marketing channels, default due date, messaging policy, and how long to keep notifications and sign-in history.
- **CORS origins managed from the UI**: add a staging site or custom domain without redeploying. Origins are validated (https only, no paths).
- A server status panel: email, ClamAV, export-network allowlist, trusted proxy hops.


### 🔐 Account protection
- **Two-step sign-in (TOTP)** with any authenticator app, plus 10 single-use recovery codes. Used codes can't be replayed.
- Admins can **require two-step sign-in for everyone**. People without it are walked through setup at their next sign-in.
- **Lockout** after 5 wrong passwords in a row (configurable). The user and the admins are both notified.
- **Per-network rate limiting** on sign-in.
- **Breached-password check** against Have I Been Pwned using k-anonymity, so the password itself never leaves the server.
- **Alerts for unfamiliar networks**: signing in from an IP that account has never used before triggers a notification.
- **Sessions can be revoked.** Changing your password, "sign out everywhere", an admin reset, disabling an account or deleting it all kill existing sessions and live sockets straight away.
- No public sign-up. Admins create accounts with a **one-time password**, and the person has to replace it at first sign-in.

### 🛡️ File Shield
Every upload (task submissions and message attachments) is checked **by reading its bytes**. The filename and the browser's MIME type aren't trusted.

| Blocked | Example |
|---|---|
| Programs disguised as documents | an `.exe` (MZ header), ELF or Mach-O binary named `.pdf` |
| Hidden text-direction characters | `invoice‮fdp.exe` |
| Content that doesn't match the extension | a "PNG" that's really a PDF |
| Executable file types | `.exe .scr .bat .ps1 .vbs .jar .iso .lnk …` (configurable) |
| Executables inside zip archives | `photos.zip → payload.exe` |
| Admin-banned files | the same bytes under *any* name |
| EICAR test signature / ClamAV hits | with optional `CLAMAV_HOST` |

| Allowed, with a warning shown to the recipient |
|---|
| Macro-enabled Office files, or a `.docx` that secretly contains macro code |
| Password-protected archives, whose contents can't be scanned |
| Scripts and HTML/SVG files |

Every accepted file gets a **SHA-256 fingerprint**. It's shown as a coloured strip so you can compare two files at a glance. The file is **re-hashed on every download**, and a file that was changed on disk is refused and the admins are alerted. Downloads are always served as attachments with `nosniff`, so an uploaded HTML file can never run in the app's origin. Stored filenames have bidi control characters swapped for a visible `[U+202E]`.

### 📜 Tamper-evident audit log
Every important action (sign-ins, task changes, file uploads, blocks and downloads, exports, settings, user management) is written to an append-only log where **each entry includes the hash of the one before it**:

- A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` on the log.
- If someone bypasses that, **Verify integrity** recomputes the whole chain and pinpoints the first entry that was edited, removed or reordered.
- The current head hash is shown so you can record it outside the system. That detects even a full rewrite by someone with superuser access to the database.

### ✅ Work
- **Review workflow:** To do → In progress → **In review** → Done. Admins approve or *request changes* with feedback, and the full submission history is kept.
- Tasks have a type, priority, due date and overdue tracking. Admins can edit, reassign, reopen and delete.
- Member board (kanban), and an admin list or board with filters, search and shareable URLs.
- **Admin overview:** review queue, team workload, due soon, security posture and recent activity.
- Comments on each task, notifications for assignments, reviews and comments, and live updates over WebSockets.
- **Messages:** real-time chat between admins and members, with unread counts, read receipts, a typing indicator and file attachments (scanned by File Shield). Members can't message each other: every conversation includes an admin.
- **Direct transfer:** browser-to-browser WebRTC for large files. The server relays only the handshake. The UI says these files skip File Shield, every offer is audited, and admins can switch the feature off.
- **Exports** (approved networks only): a PDF or Word report per task with submissions, reviews, discussion and file fingerprints, plus a CSV of all tasks with spreadsheet formula injection neutralised.
- Its own mark (an arched bulkhead door with a green "cleared" light), a full icon set (SVG/ICO favicons, Apple touch icon, PWA and maskable icons), an installable web manifest, and a 1200×630 link-preview card for Slack, WhatsApp and LinkedIn. Tab titles follow the page and workspace, e.g. "Tasks · Northwind Studio".
- Fonts (Archivo, IBM Plex Mono) ship with the app, so there are no third-party font requests.
- Light and dark themes, a responsive layout with a mobile tab bar, keyboard focus states and reduced-motion support.

### 🧱 Hardening
- The **IP allowlist can't be spoofed.** The original version trusted any `X-Forwarded-For` header. Now `TRUST_PROXY` is an explicit hop count.
- **Uploads can't escape the upload folder.** Files are stored under random UUID names and the client's filename is never used as a path.
- Helmet security headers, strict CORS (it refuses to run wide open in production), JSON body limits and zod validation on every input.
- Errors from async handlers are caught and logged. Clients get a clean JSON message and no stack traces.
- The app **won't start in production** with a weak `JWT_SECRET`.
- 2FA secrets are encrypted at rest (AES-256-GCM).
- **Versioned migrations** run automatically on boot. They're safe to run against the original v1 database.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · Vite 6 · React Router 7 · Zustand · Axios · Socket.io client · lucide icons |
| Backend | Node 20+ · Express 5 · Socket.io · zod · helmet · express-rate-limit · background job scheduler |
| Database | PostgreSQL 13+ |
| Files | Multer → File Shield → local disk · file-type · optional ClamAV |
| Exports | PDFKit · docx |
| Email | Nodemailer (any SMTP provider) |
| Tests | `node:test`: 33 end-to-end API tests against a real Postgres |

## Project structure

```
airlock/
├── client/                      React + Vite SPA
│   └── src/
│       ├── pages/               Home · Tasks · Projects · Project · Reports · People · Settings · Profile · Messages · Login · Reset · Setup
│       │   ├── admin/           Overview (leads' home) · Accounts · Security
│       │   └── member/          Work (members' home board)
│       ├── components/          Shell · CommandPalette · TaskViews (list/board/calendar) · TaskDrawer · TaskForm · ChipInput · DirectTransfer · ui
│       ├── store/               auth · live (realtime) · workspace (people/projects/teams cache) · toast
│       └── lib/                 format · download · activity
├── server/
│   ├── src/
│   │   ├── routes/              auth · me · users · teams · projects · tasks · messages · notifications · search · reports · integrations · admin · avatars
│   │   ├── lib/                 access (permissions) · fileShield · audit · webhooks · netguard (SSRF) · mailer · scheduler · templates · taskOps · totp · passwords · …
│   │   ├── middleware/          authenticate (sessions + API tokens) · requireSetupComplete · requireAdmin/Lead · restrictToAllowedIPs
│   │   ├── migrations/          001_baseline · 002_security_and_workflow · 003_workspace_teams_projects
│   │   └── scripts/             create-admin.js
│   └── test/                    api.test.js · workspace.test.js
├── docker-compose.yml           Postgres + API + Mailpit (+ ClamAV)
└── .github/workflows/ci.yml
```

## Getting started

### 1. API

```bash
cd server
cp .env.example .env        # set DATABASE_URL, JWT_SECRET, FRONTEND_URL
npm install
npm run dev                 # migrates the database, then serves on PORT
```

### 2. Create the first admin

```bash
npm run create-admin -- --email you@company.com --name "Your Name"
```

This prints a one-time password. Sign in with it and you'll be asked to choose your own. Running the command again for the same email resets that admin, which is how you recover if the only admin gets locked out.

### 3. Frontend

```bash
cd client
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

Or run the whole backend with Docker: `docker compose up --build`. Emails then show up in Mailpit at http://localhost:8025.

### 4. Tests

```bash
cd server
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/airlock_test npm test
```

The test database is wiped at the start of each run, so **never point this at real data.**

## Deploying

**API:** use a host that keeps a Node process running (Render, Railway, Fly, a VPS, or Hugging Face Spaces with the included Dockerfile). Socket.io and on-disk uploads don't work on serverless.
- Set `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `FRONTEND_URL` and `TRUST_PROXY=1`.
- Set `SMTP_URL` and `MAIL_FROM` to turn on invites, password resets and email notifications.
- Mount a persistent volume at `UPLOAD_DIR` (`/data/uploads` in the Docker image). Without one, uploads are lost on every redeploy.

**Frontend:** import the repo into Vercel. The root `vercel.json` builds `client/`. Set `VITE_API_URL` to the API origin, then redeploy (Vite bakes it in at build time).

### Production checklist
- [ ] `JWT_SECRET` and `DATA_ENCRYPTION_KEY` are long and random (the API refuses to start otherwise)
- [ ] `FRONTEND_URL` is your real frontend origin
- [ ] `TRUST_PROXY` matches your hosting (usually `1`)
- [ ] `ADMIN_ALLOWED_IPS` lists the networks allowed to export deliverables
- [ ] Persistent storage is mounted at `UPLOAD_DIR`
- [ ] Your admin account has two-step sign-in on, and **Require two-step sign-in** is switched on under Security → Settings
- [ ] Database backups are enabled with your Postgres provider
- [ ] `SMTP_URL` / `MAIL_FROM` are set, and a test invite arrives
- [ ] Any extra frontends (staging, custom domain) are added under Settings → Access & CORS
- [ ] Optional: a ClamAV container with `CLAMAV_HOST` set; a TURN server (`VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL`) if direct transfers need to work across strict corporate firewalls

## Environment variables

See [`server/.env.example`](server/.env.example) for the full annotated list. The key ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs sessions. 32+ random characters, required in production |
| `DATA_ENCRYPTION_KEY` | Encrypts 2FA secrets at rest |
| `FRONTEND_URL` | Comma-separated allowed origins for CORS and WebSockets (more can be added in Settings) |
| `SMTP_URL` / `MAIL_FROM` / `APP_URL` | Email delivery and the link base used in emails |
| `TRUST_PROXY` | Number of proxies in front of the API (`0` local, `1` most hosts) |
| `ADMIN_ALLOWED_IPS` | Networks allowed to export or download deliverables |
| `UPLOAD_DIR` / `MAX_UPLOAD_MB` | File storage location and size limit |
| `CLAMAV_HOST` | Optional virus scanner |
| `VITE_API_URL` | Frontend only: the API origin |
| `VITE_PUBLIC_URL` | Frontend only: its own public address, used for absolute link-preview image URLs (automatic on Vercel) |

## API

Every screen uses a plain JSON API, so anything the UI does can be scripted. Create a token under **Profile → API tokens**, then:

```bash
# My open tasks
curl -H "Authorization: Bearer alk_…" "$API/tasks?assignee=me&status=open"
# Find a task by key
curl -H "Authorization: Bearer alk_…" "$API/tasks?q=WEB-42"
# Comment from CI after a deploy (write token)
curl -X POST -H "Authorization: Bearer alk_…" -H "Content-Type: application/json" \
     -d '{"message":"Deployed to staging in build #318"}' "$API/tasks/42/comments"
```

Webhook receivers should verify `X-Airlock-Signature` = `sha256=` + HMAC-SHA256(secret, `X-Airlock-Timestamp` + "." + raw body), and reject timestamps older than five minutes.

## Known limitations

- Files are stored on local disk. One persistent volume is fine for a single server, but running several API instances needs shared storage (S3/R2), and that isn't built in yet.
- File Shield catches disguised, mismatched and known-dangerous files. Without ClamAV it doesn't do signature-based virus detection, so connect ClamAV if your team handles files from outside.
- Session tokens are kept in `localStorage`, because the frontend and API run on different domains. They're revocable server-side and short-lived, and the strict CSP on the API plus no inline user HTML keep the XSS surface small.
- Direct (P2P) transfers keep the whole file in the receiver's browser memory, so very large files (several GB) should go as normal attachments.
- There are no group chat channels yet. Discussion happens in task comments (with @mentions) and direct messages.
- SSO (Google / Microsoft sign-in) and SCIM provisioning aren't built in.

## License

MIT. Use it, modify it, ship it.
