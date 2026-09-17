-- A character offered to a player is held for them while they decide (maintainer, 2026-09-17).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Until now `GET /overseer/choices` offered four out of a shared pool and reserved nothing, so the
-- offer was a suggestion: whoever pressed first won and everybody else got `PRESET_TAKEN` on a
-- person the screen was still showing them. Measured on a live server with five accounts
-- registering at once, three of the five collided on their first pick. That is not a rare edge at
-- launch, it is what a launch *is*.
--
-- So an offer is a hold now. Drawing a batch writes a row per character, and nothing else may be
-- offered or taken while those rows are live. They expire, because a player who closes the tab must
-- not take four of thirty characters out of the world for ever.
CREATE TABLE overseer_holds (
  -- The character. One hold per character at a time, which is the whole point of the table.
  preset_id  TEXT PRIMARY KEY,
  -- Who it is being held for.
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- When the hold lapses, ISO-8601. Swept on the next read rather than by a timer: the read is the
  -- only thing that cares, and a sweep that needs a scheduler is a sweep that stops on restart.
  expires_at TEXT NOT NULL
) STRICT;

-- The two questions asked of it: what is this account holding, and what has lapsed.
CREATE INDEX idx_overseer_holds_user ON overseer_holds (user_id);
CREATE INDEX idx_overseer_holds_expiry ON overseer_holds (expires_at);
