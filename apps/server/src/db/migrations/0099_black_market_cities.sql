-- The fence is a city's, not the world's (maintainer, 2026-09-17).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- The Runner's barrow and the Bar's room already belong to a city, and the rule that opened them
-- ("hold one location in a district and its rooms open to you") named the back room in the same
-- breath. It was the one door of the three that could not be walked through: its screen carried a
-- city tag that was a label rather than a picker, because the shelf, the lot ids and the turnover
-- counter were keyed by the day and the slot alone, so switching the label would have changed the
-- word over the crates without changing the crates.
--
-- Two of those three are fixed without touching a table. `blackLotId` now carries a room prefix, so
-- `black_market_bids` and `black_market_lot_results`, both keyed on the lot id, separate into one
-- ledger per city on their own. The prefix is empty for the open city, which is why no row already
-- in either table is orphaned by this: every Ashfall lot keeps the id it was filed under.
--
-- The turnover counter is the one that needs a column, because it is keyed `(day, slot_index)` and
-- two cities' slot 3 turn over independently.

-- SQLite cannot add a column to a primary key, so the table is rebuilt.
--
-- `city_id` defaults to the open city on the way across: every row that exists was written before
-- any other city could be reached, so Ashfall is not a guess about that data, it is the only thing
-- it can have meant.
CREATE TABLE black_market_slots_new (
  day        TEXT NOT NULL,
  -- The city whose back room this slot stands in. `city/atlas.ts` holds the ids.
  city_id    TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, city_id, slot_index)
) STRICT;

INSERT INTO black_market_slots_new (day, city_id, slot_index, generation)
SELECT day, 'ashfall', slot_index, generation FROM black_market_slots;

DROP TABLE black_market_slots;
ALTER TABLE black_market_slots_new RENAME TO black_market_slots;

-- The allowance stays a crew's day rather than a crew's day per city, which is the rule the fence
-- has always had ("one a day") and the reading a player would expect: walking to Saltmarch is not a
-- second helping. `black_market_takings` is therefore untouched, and `idx_..._takings_day` still
-- answers the only question the limit asks. What does change is that a receipt's `slot_index` no
-- longer identifies a crate on its own, so the column that was already there for the crate's
-- identity, `good_id`, is now the only one that does. Nothing reads `slot_index` off a taking.
