-- The Runner's barrow becomes an auction (market extension, board 2026-09-08).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Buying off the barrow is gone. A line with two crews after it used to go to whoever pressed Buy
-- first, which rewards a fast connection and nothing else. Every line is a lot now: while he is in,
-- crews bid on it in the open, and when he packs up the highest bidder takes one and pays their bid.
--
-- `vendor_sales` is untouched and still keyed on (day, line_id). It is the city's stock counter,
-- and the close writes one unit into it per lot, so a line with two on it can go up again on the
-- second visit and a one-of-a-kind blueprint is gone after the first.

-- One crew's bid on one lot: one line, on one of the day's two visits.
--
-- The visit is in the key, not just the day. He is in twice, and a line with stock to spare is a
-- fresh lot the second time he comes round: bids from the morning must not carry over into the
-- afternoon, or the crew that led at noon leads a lot nobody else knew had reopened.
CREATE TABLE vendor_bids (
  -- The game day (Athens), `YYYY-MM-DD`, as `vendor_sales.day` carries it.
  day TEXT NOT NULL,
  -- Which of the day's sessions, indexed as `vendorSessionsFor` returns them.
  session INTEGER NOT NULL,
  -- The line id as it was on the day, `<day>-<index>-<item>`. Opaque here, as everywhere else.
  line_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The district the goods go to if this wins, and whose caps pay. Stored rather than looked up at
  -- the close, so the crew that bid is the crew that gets it. No foreign key on purpose: bot
  -- districts are deleted and recreated by the seeder, and a reference from here would make that
  -- fail over rows that have nothing to do with bots.
  base_id TEXT NOT NULL,
  -- Caps. Raising replaces it: a bid is a position, not a history.
  amount INTEGER NOT NULL,
  at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, session, line_id, user_id)
) STRICT;

-- The barrow reads a whole lot's bids to show who is leading and to rank the close
-- (day, session, line), and reads one crew's visit for its own results panel (user, day, session).
CREATE INDEX idx_vendor_bids_lot ON vendor_bids (day, session, line_id);
CREATE INDEX idx_vendor_bids_user_visit ON vendor_bids (user_id, day, session);

-- How one lot ended.
--
-- Written once at the close, and it is also the marker that says the close has happened: the
-- settler looks for lots with bids and no result row whose visit is over, so a row here is what
-- stops a lot being settled twice and handing a second unit off a one-of-a-kind line.
--
-- A NULL winner with a NULL price is a lot nobody in the ranking could pay for, which is a real
-- outcome and not a missing row.
--
-- `item` is denormalised for the same reason the Bar stores a recruit's name: the results panel
-- has to say what was won, and the catalogue a barrow was drawn from can move under it.
CREATE TABLE vendor_lot_results (
  day TEXT NOT NULL,
  session INTEGER NOT NULL,
  line_id TEXT NOT NULL,
  item TEXT NOT NULL,
  winner_user_id TEXT REFERENCES users (id),
  price INTEGER,
  settled_at TEXT NOT NULL,
  PRIMARY KEY (day, session, line_id)
) STRICT;
