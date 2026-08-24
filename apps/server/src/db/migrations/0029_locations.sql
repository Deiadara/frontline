-- Places are called locations now (GDD §A4).
--
-- A rename, and worth a migration rather than a find-and-replace in 0013, because 0013 has already
-- run on every database that exists: rewriting it would leave a developer's own copy with a
-- `place_control` table and a server that only knows how to read `location_control`.
--
-- The word matters more than a rename usually does. A district holds a graveyard, a gym, a
-- planetarium and a tavern: a "place" is anywhere, and a *location* is a thing on a board that you
-- take, hold, upgrade and lose. The rest of the vocabulary hangs off it: you capture a location, you
-- level a location, and holding every location in a district is what a unified bonus is for.

ALTER TABLE place_control RENAME TO location_control;
ALTER TABLE location_control RENAME COLUMN place_id TO location_id;
-- `scheduled_battles` needs more than a renamed column: its CHECK constraints spell the target
-- kind out as the literal 'place', and sqlite cannot alter a CHECK. So the table is rebuilt, which
-- is the standard sqlite dance, new table, copy, drop, rename, and the rows are rewritten as they
-- go so a battle called before this migration still resolves after it.
CREATE TABLE scheduled_battles_new (
  id TEXT PRIMARY KEY,
  attacker_base_id TEXT NOT NULL REFERENCES bases (id),
  -- 'location' | 'gate' | 'building'
  target_kind TEXT NOT NULL CHECK (target_kind IN ('location', 'gate', 'building')),
  district_id TEXT NOT NULL,
  -- Set only for a 'location' target, and only then.
  location_id TEXT,
  -- Set only for a 'building' target.
  building_id TEXT,
  defender_json TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  resolved_at TEXT,
  seed TEXT NOT NULL,
  analysis_json TEXT,
  hold_after_capture INTEGER NOT NULL DEFAULT 0,
  CHECK ((target_kind = 'location') = (location_id IS NOT NULL)),
  CHECK ((target_kind = 'building') = (building_id IS NOT NULL))
);

INSERT INTO scheduled_battles_new
  (id, attacker_base_id, target_kind, district_id, location_id, building_id,
   defender_json, scheduled_for, declared_at, resolved_at, seed, analysis_json, hold_after_capture)
SELECT
  id, attacker_base_id,
  CASE target_kind WHEN 'place' THEN 'location' ELSE target_kind END,
  district_id, place_id, building_id,
  defender_json, scheduled_for, declared_at, resolved_at, seed, analysis_json, hold_after_capture
FROM scheduled_battles;

DROP TABLE scheduled_battles;
ALTER TABLE scheduled_battles_new RENAME TO scheduled_battles;

CREATE INDEX idx_scheduled_battles_due ON scheduled_battles (resolved_at, scheduled_for);
CREATE INDEX idx_scheduled_battles_attacker ON scheduled_battles (attacker_base_id);
CREATE INDEX idx_scheduled_battles_district ON scheduled_battles (district_id);

-- `ALTER TABLE ... RENAME TO` carries indexes across but keeps their old names, and an index called
-- `idx_place_control_holder` on a table nobody calls that any more is the kind of thing that is
-- confusing at exactly the wrong moment.
DROP INDEX IF EXISTS idx_place_control_holder;
CREATE INDEX IF NOT EXISTS idx_location_control_holder ON location_control (holder_base_id);

-- §A4: a location is a board-game post now: it holds a level, it pays more at each one, and losing
-- it resets the work. Level 1 on capture is the whole tension of the system, so the default is 1
-- rather than 0 and everything standing today starts where a fresh capture would.
ALTER TABLE location_control ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
-- Set while a level is being worked on; null when nothing is under way, exactly like fortification.
ALTER TABLE location_control ADD COLUMN upgrading_until TEXT;
