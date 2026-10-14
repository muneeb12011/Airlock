-- Baseline: the original Airlock tables, plus the ones the first version's
-- code depended on but never created (task_comments, messages, tasks.type,
-- tasks.priority). Every statement is idempotent so this is safe to run on a
-- database that already has some or all of these tables.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'member',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  due_date      DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type     VARCHAR(20) NOT NULL DEFAULT 'other';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium';

CREATE TABLE IF NOT EXISTS task_submissions (
  id            SERIAL PRIMARY KEY,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes         TEXT,
  file_path     TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_logs (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ip_address    VARCHAR(64),
  user_agent    TEXT,
  login_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_comments (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id            SERIAL PRIMARY KEY,
  sender_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT,
  file_path     TEXT,
  file_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);
