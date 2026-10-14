-- v3: multi-team workspace. Manager role, teams, projects (with per-project
-- task keys like MKT-42), richer tasks (labels, estimates, checklists, links,
-- dependencies, channels), recurring templates, profiles, API tokens,
-- outgoing webhooks, email invites / password resets.

-- ---------- profiles & roles ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS title          VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio            TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone       VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_file_id UUID REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prefs   JSONB NOT NULL DEFAULT
  '{"email_assigned": true, "email_review": true, "email_mention": true, "email_security": true}'::jsonb;
-- role: admin | manager | member
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'manager', 'member')) NOT VALID;

-- ---------- teams ----------
CREATE TABLE IF NOT EXISTS teams (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(80) NOT NULL UNIQUE,
  description  TEXT,
  color        VARCHAR(16) NOT NULL DEFAULT '#0e5f50',
  lead_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ---------- projects ----------
CREATE TABLE IF NOT EXISTS projects (
  id           SERIAL PRIMARY KEY,
  key          VARCHAR(8) NOT NULL UNIQUE,          -- "MKT", "WEB"
  name         VARCHAR(120) NOT NULL,
  description  TEXT,
  kind         VARCHAR(20) NOT NULL DEFAULT 'general', -- general | marketing | engineering | design | ops
  color        VARCHAR(16) NOT NULL DEFAULT '#2f5aa8',
  team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | archived
  goal         TEXT,
  start_date   DATE,
  end_date     DATE,
  next_number  INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

-- ---------- tasks ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS number      INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS labels      TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate    SMALLINT;       -- story points / hours, team's choice
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS channel     VARCHAR(40);    -- marketing: blog, email, instagram…
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date  DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_tasks_labels ON tasks USING GIN (labels);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_number ON tasks(project_id, number) WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_checklist (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text        VARCHAR(300) NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist(task_id, position);

CREATE TABLE IF NOT EXISTS task_links (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       VARCHAR(200),
  kind        VARCHAR(30) NOT NULL DEFAULT 'link', -- github_pr | github_issue | gitlab_mr | figma | google_doc | link
  added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_links_task ON task_links(task_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

-- ---------- recurring templates ----------
CREATE TABLE IF NOT EXISTS task_templates (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  description   TEXT,
  type          VARCHAR(20) NOT NULL DEFAULT 'other',
  priority      VARCHAR(20) NOT NULL DEFAULT 'medium',
  labels        TEXT[] NOT NULL DEFAULT '{}',
  channel       VARCHAR(40),
  estimate      SMALLINT,
  checklist     JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recurrence    VARCHAR(10) NOT NULL DEFAULT 'none', -- none | daily | weekly | monthly
  due_in_days   SMALLINT NOT NULL DEFAULT 3,
  next_run_on   DATE,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- API tokens ----------
CREATE TABLE IF NOT EXISTS api_tokens (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(80) NOT NULL,
  token_hash    CHAR(64) NOT NULL UNIQUE,
  prefix        VARCHAR(16) NOT NULL,
  scope         VARCHAR(10) NOT NULL DEFAULT 'read', -- read | write
  last_used_at  TIMESTAMPTZ,
  last_used_ip  VARCHAR(64),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- ---------- outgoing webhooks ----------
CREATE TABLE IF NOT EXISTS webhooks (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(80) NOT NULL,
  url_enc         TEXT NOT NULL,          -- encrypted: Slack/Discord URLs are secrets
  url_hint        VARCHAR(120) NOT NULL,  -- "hooks.slack.com/…/abc"
  format          VARCHAR(10) NOT NULL DEFAULT 'json', -- json | slack | discord
  secret_enc      TEXT,                   -- HMAC signing secret (json format)
  events          TEXT[] NOT NULL,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  active          BOOLEAN NOT NULL DEFAULT true,
  last_status     INTEGER,
  last_error      TEXT,
  last_sent_at    TIMESTAMPTZ,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- invites & password resets ----------
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash  CHAR(64) PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     VARCHAR(10) NOT NULL, -- invite | reset
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

-- ---------- workspace settings ----------
INSERT INTO app_settings (key, value) VALUES
  ('workspace_name', '"Airlock"'::jsonb),
  ('extra_origins', '[]'::jsonb),
  ('member_dm', '"team"'::jsonb),           -- off | team | all
  ('retention_days', '180'::jsonb),
  ('default_due_days', '7'::jsonb),
  ('channels', '["Blog", "Email", "Instagram", "LinkedIn", "X", "YouTube", "Website", "Ads"]'::jsonb)
ON CONFLICT DO NOTHING;

-- ---------- reminders ----------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_on DATE;
