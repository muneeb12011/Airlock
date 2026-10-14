-- v2: account security (2FA, lockout, session revocation), File Shield,
-- review workflow, notifications, read receipts, tamper-evident audit log.

-- ---------- users ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes       JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step       BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active            BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE users SET email = lower(email) WHERE email <> lower(email);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- ---------- tasks ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE tasks SET completed_at = updated_at WHERE status = 'completed' AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ---------- File Shield ----------
CREATE TABLE IF NOT EXISTS files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key    TEXT UNIQUE NOT NULL,
  original_name  TEXT NOT NULL,
  size_bytes     BIGINT NOT NULL,
  declared_mime  TEXT,
  detected_type  TEXT,
  sha256         CHAR(64) NOT NULL,
  risk_level     VARCHAR(10) NOT NULL DEFAULT 'clean', -- clean | warn
  risk_notes     JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);

CREATE TABLE IF NOT EXISTS blocked_uploads (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
  original_name  TEXT,
  size_bytes     BIGINT,
  sha256         CHAR(64),
  reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
  context        TEXT,
  ip_address     VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS banned_hashes (
  sha256      CHAR(64) PRIMARY KEY,
  reason      TEXT,
  banned_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- submissions / review ----------
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS file_id      UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS file_name    TEXT;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS review_note  TEXT;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE task_submissions ADD COLUMN IF NOT EXISTS reviewed_at  TIMESTAMPTZ;
-- Legacy submissions were auto-approved by the old flow.
UPDATE task_submissions s SET review_status = 'approved'
  FROM tasks t WHERE t.id = s.task_id AND t.status = 'completed' AND s.review_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_submissions_task ON task_submissions(task_id);

CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);

-- ---------- messages ----------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(recipient_id) WHERE read_at IS NULL;

-- ---------- login activity ----------
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS success         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS reason          TEXT;
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS email_attempted TEXT;
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS new_ip          BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_login_logs_at ON login_logs(login_at DESC);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ---------- settings ----------
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('enforce_2fa', 'false'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('allow_p2p', 'true'::jsonb) ON CONFLICT DO NOTHING;

-- ---------- tamper-evident audit log ----------
-- No foreign keys on purpose: deleting a user must never rewrite history.
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     INTEGER,
  actor_name   TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL,
  prev_hash    CHAR(64) NOT NULL,
  hash         CHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
