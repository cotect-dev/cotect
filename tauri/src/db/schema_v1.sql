CREATE TABLE providers (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  api_key       TEXT,
  detected_json TEXT,
  health_json   TEXT,
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE active_assignment (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  default_provider_id      TEXT,
  default_model            TEXT,
  implement_provider_id    TEXT,
  implement_model          TEXT,
  research_provider_id     TEXT,
  research_model           TEXT,
  plan_provider_id         TEXT,
  plan_model               TEXT
);

CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE repos (
  id        INTEGER PRIMARY KEY,
  root_path TEXT UNIQUE NOT NULL
);

CREATE TABLE structure_notes (
  repo_id      INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  folder_path  TEXT NOT NULL,
  note         TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  head_sha     TEXT,
  UNIQUE(repo_id, folder_path)
);

CREATE TABLE agent_usage (
  id                INTEGER PRIMARY KEY,
  ts                INTEGER NOT NULL,
  provider_id       TEXT NOT NULL,
  model             TEXT NOT NULL,
  role              TEXT NOT NULL,
  task_id           TEXT,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  first_token_ms    INTEGER,
  total_ms          INTEGER,
  ok                INTEGER NOT NULL,
  tokens_estimated  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_usage_ts       ON agent_usage(ts);
CREATE INDEX idx_usage_provider ON agent_usage(provider_id);
