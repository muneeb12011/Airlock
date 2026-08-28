import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import authRoutes from "./routes/auth.js";
import taskRoutes from "./routes/tasks.js";
import adminRoutes from "./routes/admin.js";
import commentsRouter from "./routes/comments.js";
import messagesRouter from "./routes/messages.js";

const app = express();

// Needed so req.ip reflects the real client IP when behind Vercel's proxy,
// which matters for the IP allowlist check on admin downloads.
app.set("trust proxy", true);

// Lock CORS down to your actual frontend URL in production.
// Set FRONTEND_URL in Vercel's env vars (e.g. https://taskmanager.vercel.app).
// Falls back to "*" for local dev convenience.
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
  })
);
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/tasks", taskRoutes);
app.use("/admin", adminRoutes);
app.use("/tasks", commentsRouter);   
app.use("/messages", messagesRouter);

export default app;
