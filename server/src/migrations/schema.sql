-- Run this once against your PostgreSQL database to set up all tables.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | in_progress | completed
  due_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_submissions (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  file_path     TEXT, -- optional uploaded deliverable (zip/screenshot/etc.)
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ip_address    VARCHAR(64),
  user_agent    TEXT,
  login_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);
