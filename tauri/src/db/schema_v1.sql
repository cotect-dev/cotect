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
