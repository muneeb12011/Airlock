<div align="center">

# 🔒 Airlock

**A locked-down channel between one admin and a small team — nothing moves through it unless it's authorized.**

[![Node](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)](#)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](#)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-database-4169E1?logo=postgresql&logoColor=white)](#)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](#)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](#)
[![Socket.io](https://img.shields.io/badge/Socket.io-realtime-010101?logo=socketdotio&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

</div>

---

## What this is

Most task boards assume an open team where everyone sees everything. Airlock assumes the opposite: **one admin controls who exists, who sees what, and who can move files in or out** — and that last part is enforced at the network layer, not just behind a login screen.

Admin creates the team, assigns work, and is the only one who can pull finished deliverables out of the system — and only from an IP it already trusts. Every login is recorded: who, when, from where. Every file that moves — a submission, a message attachment — passes through an authenticated, authorized gate. Nothing gets through unchecked.

## ✨ Features

#### For the admin
- 👤 Create team accounts — no public sign-up, ever
- 📋 Create and assign tasks with type, priority, and due date
- 👁 See every task across the team, live
- 📄 Export any completed task as a **PDF or Word doc**, auto-built from the task + the member's submission
- 📎 Pull the raw file a member attached to their submission
- 🕵️ Full login history — user, IP, user-agent, timestamp
- 💬 Comment on tasks and message any member directly, with attachments
- 🗑 Remove a member — cleanly cascades their tasks, comments, messages, and files

#### For team members
- ✅ See only their own tasks
- 🚧 Mark a task "in progress"
- 📤 Submit finished work — notes + optional file, auto-marks the task complete and forwards a copy to the admin's inbox
- 💬 Comment on their tasks, message the admin directly

#### Platform
- 🟢 Live presence — see who's online, over WebSockets
- 🔗 WebRTC signaling relay for direct browser-to-browser transfer — the server forwards the handshake only, never touches the payload
- 🗄 Every login persisted to Postgres, not just console output

## 🛡️ How the lockdown actually works

The requirement behind this project: *"the public internet shouldn't be able to reach this, and only the admin can trigger a download."* Two independent checks gate every `/admin/*` route — both have to pass:

```
Request → [1] Valid admin JWT? → [2] Request IP in allowlist? → ✅ Through the airlock
             ↓ no                     ↓ no
           403                      403
```

1. **`authenticate`** verifies the JWT *and* re-checks the user still exists in the database on every request — delete someone's account and their existing token stops working immediately, not just at expiry.
2. **`restrictToAllowedIPs`** only lets requests through from IPs listed in `ADMIN_ALLOWED_IPS`. A stolen admin token is useless from outside that list.

A valid token from the wrong network gets rejected. A request from the right network without a valid token gets rejected.

## 🧱 Tech stack

| Layer | Tech |
|---|---|
| **Frontend** | React · Vite · Zustand · React Router · Axios · Socket.io client |
| **Backend** | Node.js · Express · Socket.io |
| **Database** | PostgreSQL |
| **Auth** | JWT · bcrypt |
| **Files** | Multer (uploads) · PDFKit + `docx` (exports) |

## 📁 Project structure

```
airlock/
├── client/                  React + Vite frontend
│   └── src/
│       ├── pages/
│       │   ├── admin/       Tasks · Members · Logs · Messages
│       │   ├── member/      Pending · In Progress · Completed · Messages
│       │   └── Login.jsx
│       ├── store/           Zustand auth store
│       └── socket.js        Socket.io client
└── server/                  Express + PostgreSQL backend
    └── src/
        ├── routes/          auth · tasks · admin · comments · messages
        ├── middleware/      authenticate · requireAdmin · restrictToAllowedIPs
        ├── services/        PDF / DOCX export generation
        ├── migrations/      schema.sql
        └── socket.js        presence + WebRTC signaling
```

## 🚀 Setup

### 1. Database

Spin up a PostgreSQL database (Neon, Supabase, Render, or local).

```bash
cd server
cp .env.example .env
# edit .env — set DATABASE_URL and JWT_SECRET at minimum
npm install
npm run migrate     # creates all tables
npm run dev          # API on :5000
```

### 2. Create the first admin

There's no public sign-up by design, which means account #1 needs a manual bootstrap:

1. Temporarily comment out `authenticate, requireAdmin` on the `/register` route in `server/src/routes/auth.js`.
2. Register yourself as admin:
   ```bash
   curl -X POST http://localhost:5000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"name":"Your Name","email":"you@example.com","password":"yourpassword","role":"admin"}'
   ```
3. Restore the middleware.

Log in as admin from then on and create the team's accounts through the same, now-protected, endpoint.

### 3. Frontend

```bash
cd client
npm install
echo "VITE_API_URL=http://localhost:5000" > .env
npm run dev          # on :5173
```

### 4. Before this touches a real network

- [ ] Set `ADMIN_ALLOWED_IPS` to the exact IP(s) allowed to trigger downloads
- [ ] Set a long, random `JWT_SECRET`
- [ ] Set `FRONTEND_URL` to your real frontend origin so CORS isn't wide open
- [ ] Never commit `.env` — only `.env.example` with blank values belongs in the repo

## ⚙️ Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signs and verifies login tokens |
| `JWT_EXPIRES_IN` | Session length (default `8h`) |
| `FRONTEND_URL` | Locks CORS to your frontend origin |
| `ADMIN_ALLOWED_IPS` | Comma-separated IP allowlist for admin download routes |
| `UPLOAD_DIR` | Where submitted files land on disk |
| `PORT` | API port |

## 📌 Known limitations

- Uploaded files live on local disk — fine for a single always-on server, but won't survive a rebuild on ephemeral hosting. Swap in S3/R2 if that matters for your deployment.
- No self-service password reset — admin recreates the account.
- Built around a fixed, admin-provisioned team, not open registration.

## 📄 License

MIT — use it, modify it, ship it.