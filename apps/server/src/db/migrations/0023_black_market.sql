-- The back room of the market.
--
-- Three tables, and between them they hold almost nothing — the shelf is *derived*, not stored.
--
-- ## `black_market_slots` — one integer per slot per day
--
-- What stands in a slot is a pure function of `(day, slot_index, generation)`, so the only thing
-- worth persisting is how many times that slot has been emptied today. Everybody in the city reads
-- the same five rows and draws the same five things, and a slot nobody has touched has no row at
-- all (generation 0 is the absence of a row).
--
-- The day is the **Athens** calendar date, written as `YYYY-MM-DD`. Storing the derived day rather
-- than an instant is what makes yesterday's shelf a different set of rows instead of a subtraction
-- somebody has to get right at a summer-time boundary.
--
-- ## `black_market_takings` — one row per purchase, forever
--
-- The daily limit is enforced by counting today's rows for a crew rather than by a flag that has to
-- be reset. There is nothing to reset, no scheduler to run it, and the count is also the receipt:
-- what was taken, out of which slot, at what price. This is the black market's slice of the same
-- history `game_events` keeps.
--
-- ## `black_market_stash` — boosts bought and not yet spent
--
-- A battle boost is bought on one day and used in a fight on another, so it has to sit somewhere in
-- between. Its own table rather than a column on `bases`, so the black market owns all of its own
-- storage and the crew record does not grow a column per feature.

CREATE TABLE IF NOT EXISTS black_market_slots (
  day        TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slot_index)
);

CREATE TABLE IF NOT EXISTS black_market_takings (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  good_id    TEXT NOT NULL,
  infamy_spent INTEGER NOT NULL,
  taken_at   TEXT NOT NULL
);

-- The only query the limit needs: how many did this crew take today.
CREATE INDEX IF NOT EXISTS idx_black_market_takings_day ON black_market_takings (base_id, day);

CREATE TABLE IF NOT EXISTS black_market_stash (
  base_id TEXT NOT NULL REFERENCES bases (id) ON DELETE CASCADE,
  good_id TEXT NOT NULL,
  count   INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (base_id, good_id)
);
