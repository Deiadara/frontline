-- Declared battles, the forces moved up for them, gates and traps (GDD §A4, battle rework).
--
-- Number allocated under INTERFACES.md R6/R9 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Four pieces of state, and the split is the same one `place_control` made: world state lives in
-- its own table, per-crew state hangs off the crew.
--
-- `scheduled_battles` is a **declaration**, not a fight. It carries the ground, the mark it goes off
-- on, and the seed it will be resolved from. The seed is written at declaration rather than at
-- resolution so the fight is replayable from the row and so nobody can re-roll an outcome by
-- resolving twice. `analysis_json` is filled in once, when it happens; a row with a null
-- `resolved_at` and a non-null analysis is impossible by construction because the settler writes
-- both in one statement.
--
-- `battle_deployments` is what each side has moved onto the ground. One row per side, so the
-- primary key says out loud that a battle has exactly two participants. Units in here have **left**
-- the crew's `army_json`: a deployment is a move, not a booking, which is the only version that
-- stops one stack of Razors being promised to six fights at once.
--
-- `district_gates` records a breach. Everything else about a gate is derived from `place_control`
-- every time it is read — a district is shut exactly when one party holds all of it — but "somebody
-- kicked this in at 04:12" is a fact about the past that no amount of reading the present recovers.
--
-- The trap goes on `place_control` rather than in a table of its own: it belongs to the ground the
-- same way a garrison and a fortification level do, and it is destroyed by the same event that
-- takes those — the place changing hands.

CREATE TABLE scheduled_battles (
  id TEXT PRIMARY KEY,
  attacker_base_id TEXT NOT NULL REFERENCES bases (id),
  -- 'place' | 'gate' | 'building'
  target_kind TEXT NOT NULL CHECK (target_kind IN ('place', 'gate', 'building')),
  district_id TEXT NOT NULL,
  -- Set only for a 'place' target, and only then.
  place_id TEXT,
  -- Set only for a 'building' target.
  building_id TEXT,
  -- Who held it when the call was made. Re-read at resolution, because sixteen hours is long
  -- enough for the ground to have changed hands twice.
  defender_json TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  resolved_at TEXT,
  seed TEXT NOT NULL,
  analysis_json TEXT,
  -- Table constraints, and they have to sit after every column: sqlite parses a CHECK between two
  -- column definitions as part of the preceding column and then fails on the next name.
  CHECK ((target_kind = 'place') = (place_id IS NOT NULL)),
  CHECK ((target_kind = 'building') = (building_id IS NOT NULL))
);

-- The settler's only query: everything past its mark that has not been run.
CREATE INDEX idx_scheduled_battles_due ON scheduled_battles (resolved_at, scheduled_for);
CREATE INDEX idx_scheduled_battles_attacker ON scheduled_battles (attacker_base_id);
CREATE INDEX idx_scheduled_battles_district ON scheduled_battles (district_id);

CREATE TABLE battle_deployments (
  battle_id TEXT NOT NULL REFERENCES scheduled_battles (id),
  -- Null for the Combine and the looters, who have no crew behind them.
  base_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
  army_json TEXT NOT NULL DEFAULT '{}',
  -- The ring outside the fight. Never enters the round loop; see `battle/perimeter.ts`.
  perimeter_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (battle_id, side)
);

CREATE INDEX idx_battle_deployments_base ON battle_deployments (base_id);

CREATE TABLE district_gates (
  district_id TEXT PRIMARY KEY,
  -- Null once a breach has run out. Not deleted: the row is cheap and the absence of one is
  -- indistinguishable from a gate that was never touched, which is a distinction nothing needs.
  broken_until TEXT
);

-- One armed trap per place, as JSON so the catalogue stays in TypeScript where it can be read.
ALTER TABLE place_control ADD COLUMN trap_json TEXT;
