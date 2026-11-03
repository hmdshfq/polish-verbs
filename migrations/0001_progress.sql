-- One row per person. The whole study state is a JSON document: a few tens of
-- KB at most for 272 items, so one row is enough, and when the shape of the
-- document changes there is no migration — the client owns the shape and the
-- server never reads inside it.
CREATE TABLE IF NOT EXISTS progress (
  profile    TEXT PRIMARY KEY,   -- the sync code, a random 32-character id
  rev        INTEGER NOT NULL,   -- stamped by the server on every accepted save
  data       TEXT NOT NULL,      -- the JSON document the client keeps
  items      INTEGER NOT NULL DEFAULT 0,  -- how many items it covers, for a glance
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS progress_updated ON progress(updated_at);
