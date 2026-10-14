---
title: Airlock API
emoji: 🔒
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Airlock — API

Express 5 + PostgreSQL + Socket.io backend for Airlock. See the root `README.md` for
setup, deployment and the full feature list.

```bash
npm install
npm run dev            # migrates, then serves on $PORT
npm run create-admin -- --email you@company.com --name "You"
TEST_DATABASE_URL=postgresql://... npm test
```

On Hugging Face Spaces, set the secrets from `.env.example` in the Space settings.
Spaces' container disk isn't persistent across rebuilds, so for production
uploads attach persistent storage and point `UPLOAD_DIR` at it.
