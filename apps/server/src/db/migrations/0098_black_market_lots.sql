-- The fence's shelf becomes five auctions (maintainer, 2026-09-17).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Taking off the shelf is gone. The five slots were shared with the whole city and buying from them
-- was not: two crews after the same crate were racing a network round trip, and the one with the
-- better connection took it. Every slot is a lot now. Bids stand in the open all day in infamy, and
-- at midnight the fence settles: the highest bidder who can still pay takes the crate at what they
-- bid, inside the same one-a-day allowance the shelf has always had.
--
-- `black_market_takings` is untouched and still the receipt and the allowance counter. The close
-- writes one row per crate it hands over, exactly as the door used to, so the daily limit, the feat
-- tallies and the history all read the same table they always did.

-- One crew's bid on one lot: one slot, on one day.
--
-- The day is in the key rather than an instant, the way `black_market_slots.day` already carries
-- it: the shelf is drawn from the Athens calendar date and the lots settle at its boundary, so a
-- bid belongs to a date and not to a window somebody has to subtract.
CREATE TABLE black_market_bids (
  -- The Athens calendar date, `YYYY-MM-DD`.
  day TEXT NOT NULL,
  -- `blackLotId(day, slotIndex)`. Opaque here, as every lot id is.
  lot_id TEXT NOT NULL,
  -- Which slot it names, kept alongside so the close can find the good without parsing the id.
  slot_index INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The district the crate goes to if this wins, and whose infamy pays. Stored rather than looked
  -- up at the close, so the crew that bid is the crew that gets it. No foreign key on purpose: bot
  -- districts are deleted and recreated by the seeder, and a reference from here would make that
  -- fail over rows that have nothing to do with bots.
  base_id TEXT NOT NULL,
  -- Infamy. Raising replaces it: a bid is a position, not a history.
  amount INTEGER NOT NULL,
  at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, lot_id, user_id)
) STRICT;

-- The shelf reads a whole lot's bids to show who is leading and to rank the close (day, lot), and
-- reads one crew's day for its own standing (user, day).
CREATE INDEX idx_black_market_bids_lot ON black_market_bids (day, lot_id);
CREATE INDEX idx_black_market_bids_user_day ON black_market_bids (user_id, day);

-- How one lot ended.
--
-- Written once at the close, and it is also the marker that says the close has happened: the
-- settler looks for lots with bids and no result row whose day is over, so a row here is what stops
-- a lot being settled twice and handing out a second crate.
--
-- A NULL winner with a NULL price is a lot nobody in the ranking could pay for, or one every
-- bidder had already spent their allowance on. Both are real outcomes and not a missing row.
--
-- `good_id` is denormalised for the same reason the barrow stores an item id: what was on the shelf
-- is derived from the day, and the catalogue it is derived from can move under a results panel.
CREATE TABLE black_market_lot_results (
  day TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  good_id TEXT NOT NULL,
  winner_user_id TEXT REFERENCES users (id),
  price INTEGER,
  settled_at TEXT NOT NULL,
  PRIMARY KEY (day, lot_id)
) STRICT;
