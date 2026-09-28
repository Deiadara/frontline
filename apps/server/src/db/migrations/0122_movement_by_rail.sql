-- Whether a battle column took the train (bug pass, 2026-09-27).
--
-- Changing the machines committed to a fight re-times every column still on the road, off the
-- march clock. A column riding the rail was put back on the march clock with it, which could land
-- it after the mark and send it home instead of into the fight. The re-timer needs to know which
-- columns are on the line, and nothing recorded it. Zero for every column already walking.
ALTER TABLE troop_movements ADD COLUMN by_rail INTEGER NOT NULL DEFAULT 0;
