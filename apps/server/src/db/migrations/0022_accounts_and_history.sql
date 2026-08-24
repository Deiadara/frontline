-- Accounts a player can edit, and a ledger of everything that has happened.
--
-- ## The account columns
--
-- `users` held a credential and nothing else. Settings gives a player a name to be called by, a
-- glyph to be recognised by and a clock to read the game in. All three are nullable rather than
-- NOT NULL DEFAULT: a NULL here means "never set", which is what the application turns into the
-- house default, and that is a different fact from "set, to the same value as the default". The
-- day the default icon changes, only the first group moves.
--
-- `timezone` stores an IANA name (`Europe/Athens`), never an offset. An offset is correct for half
-- the year in any zone that observes summer time.
--
-- ## The ledger
--
-- The board's requirement is that the game "stores everything that has happened and keeps running
-- forever". Every *state* table here is already durable; what was missing is the append-only record
-- of the transitions between states. `game_events` is that record: one row per thing a player or
-- the server did, with the actor, the kind, and whatever payload the kind needs as JSON.
--
-- It is deliberately schemaless in the payload and strict in the envelope. A typed column per event
-- kind would need a migration for every new kind, and the first thing anybody would do is stop
-- writing events rather than write a migration. The envelope, who, what, when, is what queries
-- are written against, and it is fixed.
--
-- Nothing reads this table to decide anything. It is history: for recovering what a corrupted save
-- was doing, for answering "how did this crew get 40,000 scrap", and for replaying a day.

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN icon TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;

CREATE TABLE IF NOT EXISTS game_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The user who caused it, or NULL for something the server did on its own (a backup, a sweep).
  -- ON DELETE SET NULL rather than CASCADE: history outlives the account it belongs to, and an
  -- audit trail that deletes itself when somebody leaves is not an audit trail.
  actor_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  base_id    TEXT,
  kind       TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  at         TEXT NOT NULL
);

-- The two questions asked of history: "what happened to this crew" and "what happened that day".
CREATE INDEX IF NOT EXISTS idx_game_events_base ON game_events (base_id, id);
CREATE INDEX IF NOT EXISTS idx_game_events_at ON game_events (at);
