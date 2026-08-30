-- The location holder kind `faction` becomes `crew`.
--
-- It always meant "a player crew holds this ground", and the word is now needed for the thing
-- players actually asked for: a **faction** is a team of up to five players (see `factions/`).
-- Leaving the old value in place would put two unrelated meanings of one word in the same database,
-- which is how somebody eventually writes a join between them.
--
-- The CHECK constraints name the old value and SQLite cannot alter a constraint in place, so the
-- table is rebuilt. Column list copied from the live schema rather than from `0013`, because four
-- later migrations added columns to it and a rebuild off the original definition would drop them.
PRAGMA foreign_keys = OFF;

CREATE TABLE location_control_new (
  location_id TEXT PRIMARY KEY,
  -- 'unoccupied' | 'government' | 'looters' | 'crew'
  holder_kind TEXT NOT NULL CHECK (holder_kind IN ('unoccupied', 'government', 'looters', 'crew')),
  -- Set only when holder_kind = 'crew'. Not a foreign key on purpose: a base that is deleted
  -- should leave its ground standing, to be walked into by whoever gets there next.
  holder_base_id TEXT,
  fortification INTEGER NOT NULL DEFAULT 0,
  fortifying_until TEXT,
  garrison_json TEXT NOT NULL DEFAULT '{}',
  trap_json TEXT,
  level INTEGER NOT NULL DEFAULT 1,
  upgrading_until TEXT,
  CHECK ((holder_kind = 'crew') = (holder_base_id IS NOT NULL))
);

INSERT INTO location_control_new (
  location_id, holder_kind, holder_base_id, fortification, fortifying_until,
  garrison_json, trap_json, level, upgrading_until
)
SELECT
  location_id,
  CASE holder_kind WHEN 'faction' THEN 'crew' ELSE holder_kind END,
  holder_base_id,
  fortification,
  fortifying_until,
  garrison_json,
  trap_json,
  level,
  upgrading_until
FROM location_control;

DROP TABLE location_control;
ALTER TABLE location_control_new RENAME TO location_control;

PRAGMA foreign_keys = ON;
