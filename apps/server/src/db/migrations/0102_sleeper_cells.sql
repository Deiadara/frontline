-- Sleepers planted on ground nobody has fought over yet (maintainer, 2026-09-18).
--
-- "They can be sent to a location despite of a battle and they just stay there doing nothing. If
-- a battle is called there they automatically participate as attackers when it's time, but up to
-- that point they are not visible by an enemy spy or anything."
--
-- The Sleepers' own blurb has promised this since the roster was written: "Planted long ago, and
-- useful exactly once. They are already inside." Nothing in the game could express it. A garrison
-- is the only way units stand on a location and `setGarrison` refuses ground the crew does not
-- hold (`not_held`), which is precisely the ground a cell is for.
--
-- Its own table rather than a nullable `battle_id` on `troop_movements`, because a cell is not a
-- column: a column exists to arrive, and this one arrives and then *stays*, for as long as the
-- crew leaves it there. Folding the two would put a null battle on the one table the settler
-- walks every tick looking for battles.
--
-- `phase` carries all three states a cell can be in rather than a second table for the walk:
--
--   * `outbound`  - walking there. `arrives_at` is when they go to ground.
--   * `waiting`   - in place, doing nothing, invisible to everybody but their own crew.
--   * `returning` - recalled, walking home. `arrives_at` is when they rejoin the roster.
--
-- One row per crew per location, merged on arrival, so a crew that sends twice has one cell and
-- not two rows the board would have to add up.
CREATE TABLE sleeper_cells (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases (id),
  location_id TEXT NOT NULL,
  army_json TEXT NOT NULL DEFAULT '{}',
  phase TEXT NOT NULL CHECK (phase IN ('outbound', 'waiting', 'returning')),
  departed_at TEXT NOT NULL,
  arrives_at TEXT NOT NULL,
  -- How long the walk out was, in milliseconds, frozen at the send.
  --
  -- Stored rather than derived, and the reason is a bug this had on the way in. Once a cell
  -- lands, `arrives_at` is rewritten to the moment it went to ground and becomes a "planted
  -- since", so `arrives_at - departed_at` stops being the walk: on a server that was asleep for
  -- six hours when the cell landed, it reads as a six hour walk and the recall owes one.
  travel_ms INTEGER NOT NULL DEFAULT 0
);

-- The world clock walks everything whose mark has passed; the Monitor walks one crew's.
CREATE INDEX idx_sleeper_cells_arrival ON sleeper_cells (arrives_at);
CREATE INDEX idx_sleeper_cells_base ON sleeper_cells (base_id);
-- ...and `assemble` asks "is anybody of this crew's asleep on this ground" once per fight.
CREATE INDEX idx_sleeper_cells_location ON sleeper_cells (location_id);
