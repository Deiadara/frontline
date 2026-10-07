-- The faction room's log, kept at the moment things happened (maintainer, 2026-10-06): a fight a
-- member called or was called into, and help a member sent. The room stamped these with the fight's
-- mark, so they sat at the top dated tomorrow and went away when the fight was over.
CREATE TABLE faction_log (
  id TEXT PRIMARY KEY,
  faction_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  side TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX faction_log_by_faction ON faction_log (faction_id, at);
