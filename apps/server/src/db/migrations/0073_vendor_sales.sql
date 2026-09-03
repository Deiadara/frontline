-- What the city has already taken off the Runner's barrow today.
--
-- This counter existed and was a module-level `Map`, which is to say it existed for as long as the
-- process did. The comment above it said the count was stored; it was not. A restart, a crash, a
-- deploy or a second process all put a sold-out line back on the barrow inside the same UTC day,
-- so a blueprint the catalogue rations to `stock: 1` could be bought again by the next person
-- through the door. That is item duplication with a restart as the exploit.
--
-- Shaped exactly like `market_supply_runs` next door, and for the same reason: the day is the whole
-- lifetime of a line, so the day is half the key and yesterday's rows are simply never read again.
-- The stock *allowance* stays derived (`vendorStockFor` is a pure function of the date); what is
-- stored is only what has actually been sold, which is the half a pure function cannot know.
CREATE TABLE vendor_sales (
  day TEXT NOT NULL,
  line_id TEXT NOT NULL,
  -- Summed across the whole city: a sold-out line is sold out for everybody, which is the point of
  -- a rationed blueprint.
  sold INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, line_id)
);
