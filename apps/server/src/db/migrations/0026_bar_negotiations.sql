-- Haggling that survives a refresh (GDD §H7).
--
-- Number allocated under INTERFACES.md R6/R9 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- §H7 had a price check where it wanted a conversation: one endpoint that answered "yes" or "no,
-- but", statelessly, for ever. The negotiation model in `bar/negotiation.ts` gives a character a
-- reservation value, a temper and a stock of patience that an insulting offer burns through — and
-- every one of those is meaningless if the player can reload the page and start again.
--
-- So the conversation is stored, and it is stored per **player, per character, per day**, because
-- all three are what it belongs to: the Bar's roster turns over at midnight UTC, a character's
-- patience is theirs and not the room's, and one crew wearing somebody down must not wear them down
-- for everybody else. That is the same key `bar_hires` uses for the §H2b limit, one column wider.
--
-- Only the state that cannot be recomputed is here. What they *say* is a pure function of the
-- compass and the mood, so no line of dialogue is ever written to disk.

CREATE TABLE bar_negotiations (
  user_id TEXT NOT NULL REFERENCES users (id),
  day TEXT NOT NULL,
  -- The roster id as it was on the day, exactly as `bar_hires.recruit_id` carries it: an opaque
  -- handle, kept whole, so this is not a second place that grammar is authored.
  recruit_id TEXT NOT NULL,
  -- Exchanges that have happened, and what the character has left in them. Patience at zero with
  -- `closed` set is a walk-out, which is the state the whole table exists to make stick.
  rounds INTEGER NOT NULL DEFAULT 0,
  patience INTEGER NOT NULL,
  -- What they are asking for right now, in caps a week. Moves down as the player moves up.
  standing INTEGER NOT NULL,
  -- The last number the player put on the table, or NULL before they have said anything.
  last_offer INTEGER,
  -- How the last exchange went. A word from `NEGOTIATION_MOODS`, and the only thing the window
  -- needs in order to pick a face and a line.
  mood TEXT NOT NULL,
  -- Set once they have signed or gone. Nothing more can be said either way.
  closed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, day, recruit_id)
);

-- The Bar screen reads every conversation this player has open today in one go, so that is the
-- index. The primary key already covers the single-row lookup a `POST /bar/negotiate` does.
CREATE INDEX idx_bar_negotiations_user_day ON bar_negotiations (user_id, day);
