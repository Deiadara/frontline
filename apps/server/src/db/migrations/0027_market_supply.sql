-- The supply run: caps into materials, rationed by the day.
--
-- Number allocated under INTERFACES.md R6/R9: do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Caps were a currency with almost nothing to buy: wages, the Bar, research, and whatever the
-- Runner happened to have on his barrow for four hours a day. A crew could be rich and stuck. The
-- supply run is the missing half, the ordinary materials, on sale, always, and the *only* thing
-- that keeps it from replacing the district is the ration, which is a percentage of what the
-- district can store, widening with player level from 30% to 100%.
--
-- The ration is a per-day total across every material, so a day of buying is one budget a player
-- spends where the shortage is rather than five errands. That is the one number this table exists
-- to hold: everything else, the price, the share, the ceiling, is a pure function of the level
-- and the warehouse, computed in `market/supply.ts` on both sides of the wire.
--
-- Keyed by base rather than by user, unlike the Bar's daily counters: this is a warehouse limit,
-- and it is the warehouse's day that matters. `day` is the same UTC date the Runner's hours are
-- drawn from, so the whole market turns over together.

CREATE TABLE market_supply_runs (
  base_id TEXT NOT NULL REFERENCES bases (id),
  day TEXT NOT NULL,
  -- Units of material bought today, summed across every resource. Compared against
  -- `supplyAllowance(level, storageCapacity)`, which is recomputed on every read, so a crew that
  -- raises its Apothecary mid-day gets the wider ration immediately, and one that has its
  -- warehouse wrecked gets the narrower one.
  units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (base_id, day)
);
