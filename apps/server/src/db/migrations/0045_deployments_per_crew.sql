-- A battle side stops being one crew.
--
-- `battle_deployments` was keyed `(battle_id, side)`: exactly one row per side, which encoded the
-- assumption that a fight is one crew against one holder. Factions break that. An ally sending
-- units to your battle is a *second contributor on your side*, and they have to be a row of their
-- own: their bodies come out of their army, their survivors go back to them, and they get their own
-- report. Folding their units into the declarer's row would lose all three.
--
-- So the key gains `base_id`. Everything else about the row is unchanged, and the resolver now sums
-- a side's rows instead of reading one (see `battle/forces.ts`).
--
-- `base_id` is nullable and NULL is not distinct in a SQLite primary key comparison, so the
-- Combine and the looters still get exactly one row per side: their NULL collides with itself. That
-- is the behaviour wanted here rather than an accident to guard against.
PRAGMA foreign_keys = OFF;

CREATE TABLE battle_deployments_new (
  battle_id TEXT NOT NULL REFERENCES scheduled_battles (id),
  -- Null for the Combine and the looters, who have no crew behind them.
  base_id TEXT,
  side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
  army_json TEXT NOT NULL DEFAULT '{}',
  -- The ring outside the fight. Never enters the round loop; see `battle/perimeter.ts`.
  perimeter_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  boost_id TEXT,
  PRIMARY KEY (battle_id, side, base_id)
);

INSERT INTO battle_deployments_new (
  battle_id, base_id, side, army_json, perimeter_json, updated_at, boost_id
)
SELECT battle_id, base_id, side, army_json, perimeter_json, updated_at, boost_id
FROM battle_deployments;

DROP TABLE battle_deployments;
ALTER TABLE battle_deployments_new RENAME TO battle_deployments;

CREATE INDEX idx_battle_deployments_base ON battle_deployments (base_id);
CREATE INDEX idx_battle_deployments_battle ON battle_deployments (battle_id, side);

PRAGMA foreign_keys = ON;
