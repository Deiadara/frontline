-- Three upgrade slots per unit (`units/loadout.ts`). Before this every built upgrade applied to
-- every unit, so a crew mid-game is given the arrangement that costs it nothing: its three
-- strongest, on everything. The fill is done in TypeScript on first read (`rowToBase`), because
-- picking "strongest" means reading the upgrade catalogue and SQLite has no view of it.
ALTER TABLE bases ADD COLUMN unit_loadouts_json TEXT;
