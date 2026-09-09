-- The Bar becomes a city-wide daily auction (GDD §H7, board 2026-09-07).
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Three tables go, and each of them goes because the mechanic under it does.
--
-- `bar_negotiations` and `bar_standoffs` held a private conversation: patience, a walk-out and the
-- markup it bought. There is no conversation any more. Everybody bids on the same people at the
-- same time, the floor is printed on the card, and nobody walks out of an auction.
--
-- `bar_slots` is the interesting one. It held per-seat turnover, because hiring somebody used to
-- take them out of the room and put a fresh character in their chair. An auction cannot work that
-- way: the winner is not known until the close, so the room has to be the same room all day for
-- everybody bidding in it. The seat now empties at the close and refills at midnight with the rest
-- of the roster, which means the roster is once again a pure function of the day alone.
--
-- `bar_hires` stays exactly as it is. It is the signing log, and nothing reads it as a limit now:
-- the daily hire cap went with the negotiation (a crew's limit is how many tables it may sit at).

DROP TABLE IF EXISTS bar_negotiations;
DROP TABLE IF EXISTS bar_standoffs;
DROP TABLE IF EXISTS bar_slots;

-- One crew's position at one table, on one day.
--
-- Both halves of a bid live in one row rather than in two tables, because they are one position:
-- what a crew is in for is the higher of their open bid and their sealed value, and a crew has at
-- most one of each. A row with `open_amount` NULL is a sniper who only ever locked a final value;
-- a row with `sealed_amount` NULL is somebody who bid in the open and did not come back for the
-- last half hour. A row with both NULL cannot happen and is not worth a CHECK: every write path
-- sets one of them, and the read paths treat a missing amount as no position.
CREATE TABLE bar_bids (
  -- The game day (Athens), `YYYY-MM-DD`, exactly as `bar_hires.day` carries it.
  day TEXT NOT NULL,
  -- The roster id as it was on the day, `bar-<day>-<seat>-0`. Opaque here, as everywhere else.
  recruit_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The district that will sign them if this bid wins. Stored rather than looked up at the close,
  -- so the crew that bid is the crew that gets them. No foreign key on purpose: bot districts are
  -- deleted and recreated by the seeder, and a reference from here would make that fail over rows
  -- that have nothing to do with bots.
  base_id TEXT NOT NULL,
  -- The public bid, in caps a week, and when it was made. NULL until they bid in the open.
  open_amount INTEGER,
  open_at TEXT,
  -- The sealed final value, revealed only at the close. NULL until they lock one, and never
  -- changed afterwards: a locked value is a final answer, not another round.
  sealed_amount INTEGER,
  sealed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, recruit_id, user_id)
) STRICT;

-- The Bar reads a whole table's bids to show who is leading (day, recruit), and reads one crew's
-- day to count the tables they are sitting at (user, day). Those are the two questions asked.
CREATE INDEX idx_bar_bids_table ON bar_bids (day, recruit_id);
CREATE INDEX idx_bar_bids_user_day ON bar_bids (user_id, day);

-- How a table ended.
--
-- Written once per table at the close, and it is also the marker that says the close has happened:
-- the settler looks for days with bids and no result rows, so a row here is what stops a table
-- being settled twice. A winner of NULL with a NULL price is a table nobody could take, which is a
-- real outcome and not a missing row.
--
-- `recruit_name` is denormalised on purpose. The roster is a function of the day and of the city's
-- average level, and the city keeps levelling, so yesterday's sheet cannot be regenerated with
-- certainty tomorrow. The name is what the results panel prints, so the name is stored.
CREATE TABLE bar_auction_results (
  day TEXT NOT NULL,
  recruit_id TEXT NOT NULL,
  recruit_name TEXT NOT NULL,
  winner_user_id TEXT REFERENCES users (id),
  price INTEGER,
  settled_at TEXT NOT NULL,
  PRIMARY KEY (day, recruit_id)
) STRICT;
