-- §A4: units on the road.
--
-- A column that has left the crew's district and has not reached the fight yet. The units are on
-- neither the roster nor the ground while this row exists, which is the whole point: see
-- `battle/movement.ts` for why travel is what makes committing early a real decision.
--
-- One row per send rather than one per battle: a crew that sends twice sends two columns, and they
-- arrive when they arrive.
CREATE TABLE troop_movements (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases (id),
  battle_id TEXT NOT NULL REFERENCES scheduled_battles (id),
  side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
  from_district_id TEXT NOT NULL,
  to_district_id TEXT NOT NULL,
  army_json TEXT NOT NULL DEFAULT '{}',
  perimeter_json TEXT NOT NULL DEFAULT '{}',
  departed_at TEXT NOT NULL,
  arrives_at TEXT NOT NULL
);

-- The settler walks everything that has landed, and the Actions screen walks one crew's.
CREATE INDEX idx_troop_movements_arrival ON troop_movements (arrives_at);
CREATE INDEX idx_troop_movements_base ON troop_movements (base_id);
CREATE INDEX idx_troop_movements_battle ON troop_movements (battle_id);
