# Deploying Airlock

Frontend on **Vercel**, API on **Hugging Face Spaces** (Docker), database on **Neon** (or any Postgres).

Order matters: database → API → frontend → point the API back at the frontend.

---

## 0. Run it locally first (optional, 5 minutes)

Needs Node 20+ and a Postgres URL (local or Neon).

```bash
# API
cd server
cp .env.example .env        # fill DATABASE_URL, JWT_SECRET; set NODE_ENV=development,
                            # PORT=5000, FRONTEND_URL=http://localhost:5173, TRUST_PROXY=0,
                            # MAIL_TRANSPORT=log
npm install
npm run create-admin -- --email you@company.com --name "Your Name"   # prints a temp password
npm run dev                 # http://localhost:5000/health

# Frontend (second terminal)
cd client
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

Or with Docker: `docker compose up` from the project root (Postgres + API + Mailpit).

---

## 1. Database (Neon)

1. Create a project at neon.tech → copy the connection string
   (`postgresql://…neon.tech/neondb?sslmode=require`).
2. **If you reused the database from the old zip: rotate that password first.**
   The old `server/.env` had it in plain text.

Tables are created automatically when the API starts (`AUTO_MIGRATE=true`).

---

## 2. API on Hugging Face Spaces

1. huggingface.co → **New Space** → SDK: **Docker** → Blank → create.
2. Push the **contents of `server/`** (not the whole project) as the Space repo.
   `server/README.md` already has the Space header (`sdk: docker`, `app_port: 7860`)
   and `server/Dockerfile` is ready.

   ```bash
   git clone https://huggingface.co/spaces/<you>/<space-name> hf-space
   cp -r server/. hf-space/
   cd hf-space
   rm -rf node_modules uploads/* .env      # never push .env
   git add . && git commit -m "Airlock API" && git push
   ```
   (Use a Hugging Face access token with write permission as the git password.)

3. Space → **Settings → Variables and secrets**. Add as **Secrets**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | your Neon URL |
   | `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `DATA_ENCRYPTION_KEY` | another value from the same command |
   | `SMTP_URL` | optional — e.g. `smtps://resend:API_KEY@smtp.resend.com:465` |

   And as **Variables**:

   | Name | Value |
   |---|---|
   | `FRONTEND_URL` | `https://your-app.vercel.app` (fill in after step 3; no trailing slash) |
   | `MAIL_FROM` | `Airlock <no-reply@yourdomain.com>` (if using email) |

   `PORT=7860`, `TRUST_PROXY=1`, `NODE_ENV=production` are already set in the Dockerfile.

4. Wait for the build → status **Running**. Your API address is
   `https://<you>-<space-name>.hf.space` (not the huggingface.co/spaces/… page).
   Check `https://<you>-<space-name>.hf.space/health` returns `{"ok":true,…}`.

5. **Create the first admin** — from your own computer, against the same database:
   ```bash
   cd server
   npm install
   DATABASE_URL="<your Neon URL>" npm run create-admin -- --email you@company.com --name "Your Name"
   ```
   It prints a temporary password; you'll set a real one at first sign-in.

### Hugging Face limits you should know
- **Free Spaces sleep after ~48 h with no visitors.** The first request after that takes a
  while to wake it. Reminders/recurring tasks don't run while it sleeps.
- **The disk is wiped on every restart/rebuild** unless you add *Persistent storage*
  (Space settings, paid). The Dockerfile already stores uploads at `/data/uploads`,
  which is where that storage mounts — so turning it on is all you need.
  Without it, uploaded deliverables disappear on restart (tasks, chat, users are safe in Postgres).
- For a real team, Render / Railway / Fly with a volume is the more honest choice; the
  same Dockerfile works there.

---

## 3. Frontend on Vercel

1. Push the project to GitHub (the root `.gitignore` keeps `.env` and `node_modules` out).
2. vercel.com → **Add New Project** → import the repo.
3. **Root Directory: `client`**. Framework preset: Vite (auto-detected).
4. Environment Variables:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | `https://<you>-<space-name>.hf.space` (no trailing slash) |
   | `VITE_PUBLIC_URL` | optional, your custom domain (for link-preview images) |

5. Deploy. Copy the production URL (e.g. `https://airlock-xyz.vercel.app`).

`VITE_` variables are baked in at build time — change one, redeploy.

---

## 4. Connect them

1. Back in the Space settings, set `FRONTEND_URL` to the Vercel URL. The Space restarts.
   Several origins? Comma-separate them: `https://a.vercel.app,https://app.company.com`.
   Admins can also add extra origins later in **Settings → Allowed web origins**.
2. Open the Vercel URL → sign in with the admin email + temporary password → set your
   password → finish setup.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the server" / CORS error in console | `FRONTEND_URL` must exactly match the Vercel origin — `https`, no trailing slash. |
| App shows "Set VITE_API_URL…" | Env var missing in Vercel, or you didn't redeploy after adding it. |
| API crashes on start: "JWT_SECRET" | Must be at least 32 characters in production. |
| `/health` slow the first time | The Space was asleep. |
| Live updates / chat don't arrive | Make sure you use the `*.hf.space` URL, not the huggingface.co page. |
| Sign-in log shows the wrong IP | Adjust `TRUST_PROXY` (number of proxies in front of the API). Never set it higher than reality. |
| Locked out of the only admin | Run `create-admin` again with the same email — it resets and unlocks. |
