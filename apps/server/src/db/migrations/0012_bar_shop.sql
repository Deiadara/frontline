-- The Bar as a shared shop — turnover and a daily hire limit (GDD §H2, §H2b).
--
-- Number allocated under INTERFACES.md R6/R9 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- §H2 already made the roster global: one room, the same eight people for every player, recomputed
-- from the UTC date and never stored. What changes here is that the room is no longer *read-only*.
-- Hiring somebody takes them out of it for everyone, and somebody else walks in to take their seat.
--
-- That needs the smallest possible amount of state, and this is it: a per-seat counter of how many
-- people have been hired out of that seat today. The roster stays a pure function — of the date and
-- of these counters instead of the date alone — so there is still no roster table, no per-player
-- roll, and no scheduled job. A seat nobody has hired from has no row here at all, and reads as
-- generation 0, which is exactly what §H2a produced before this migration existed.
--
-- `bar_hires` is the second half: who hired whom, and when. It exists for the §H2b limit of one
-- hire per player per UTC day, which cannot be derived from anything already stored — the officers
-- on a base carry no record of the day they signed.

CREATE TABLE bar_slots (
  day TEXT NOT NULL,
  slot INTEGER NOT NULL,
  -- How many people have been hired out of this seat today. The next person to sit in it is
  -- generated from this number, so the seat produces an endless queue of distinct characters.
  generation INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slot)
);

CREATE TABLE bar_hires (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The roster id as it was on the day, `bar-<day>-<slot>-<generation>`. Kept whole rather than
  -- split into columns: it is an opaque handle everywhere else in the system, and splitting it
  -- here would make this table the second place that grammar is authored.
  recruit_id TEXT NOT NULL,
  hired_at TEXT NOT NULL
);

-- The §H2b limit is read as "how many rows does this player have for this day", so that is the
-- index. Unique would be wrong: the limit is a tunable constant, not a schema invariant, and a
-- board that raises it to two should not need a migration.
CREATE INDEX idx_bar_hires_user_day ON bar_hires (user_id, day);
