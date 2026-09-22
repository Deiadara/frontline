-- The army splits into the district and the gate, and units walk between places (maintainer,
-- 2026-09-22).
--
-- `gate_army_json` is the garrison at the district's door: what a call on the gate is met by.
-- Null reads as nobody at the door, which is true of every crew on the night this lands; the
-- Move screen is how anybody gets there.
ALTER TABLE bases ADD COLUMN gate_army_json TEXT;

-- A column on the clock between two of the crew's places. The places are JSON because there are
-- three shapes of them (`MovePlaceSchema`) and the row is only read back through the schema.
CREATE TABLE unit_moves (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  from_json      TEXT NOT NULL,
  to_json        TEXT NOT NULL,
  army_json      TEXT NOT NULL,
  vehicles_json  TEXT NOT NULL DEFAULT '{}',
  departed_at    TEXT NOT NULL,
  returns_at     TEXT NOT NULL,
  travel_minutes INTEGER NOT NULL DEFAULT 0,
  settled_at     TEXT,
  recalled_at    TEXT
);
CREATE INDEX unit_moves_due ON unit_moves (settled_at, returns_at);
CREATE INDEX unit_moves_base ON unit_moves (base_id, settled_at);

-- Units posted on a faction ally's ground. They stay the poster's (unit slots, the census) and
-- fight for the holder. One row per crew per location; an empty army is a deleted row.
CREATE TABLE allied_garrisons (
  location_id TEXT NOT NULL,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  army_json   TEXT NOT NULL,
  PRIMARY KEY (location_id, base_id)
);
CREATE INDEX allied_garrisons_base ON allied_garrisons (base_id);
