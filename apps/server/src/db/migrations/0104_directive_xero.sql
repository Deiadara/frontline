-- Directive Zero is Directive Xero (maintainer, 2026-09-20), and the id went with the name.
--
-- Three things in the database name him, and each one breaks differently if it is left alone.
--
-- 1. `location_control.garrison_json`. `ArmySchema` is `z.record(UnitIdSchema, ...)` and
--    `UnitIdSchema` refines against the *live* catalogue, so an id the catalogue has lost is not a
--    bad field, it is an unparseable key. This one column does not fail loudly, and that is worse
--    rather than better: `db/repos/city.ts` runs `withoutRetiredUnits` over the garrison on the
--    way out, so a row keeping the old key reads back as `{greycoat: 12}` with **him simply not
--    there**. `combineLeaderAlive` looks for his id in the garrison of his own plot, so the Chapel
--    at the top of the city becomes a walkover held by rank and file, silently, on a save that
--    throws nothing anywhere. The columns below have no such floor: `0038_retired_units.sql`
--    records the fault line where the row refuses to load outright.
-- 2. `crew_tallies.tally`. A scoped tally is stored under `<measure>:<scope>` and his scope is the
--    unit id, so `combine_leaders_slain:directive_zero` is a real row on any save where somebody
--    has fought him. Left alone the counter keeps its value under a key no feat reads any more,
--    and the rung sits at zero for a crew that has already earned it.
-- 3. `crew_feats.feat_id`. `directive_zero_slain` is a claimed row, and claiming is once and for
--    ever. Left alone the crew could collect the renamed feat a second time.
--
-- Every other army column is swept too rather than only the one that can be populated today. A
-- Combine sheet is met and never held (`units/faction.test.ts`), so his id should only ever be in
-- a garrison; sweeping the rest costs nothing and does not depend on that wall holding for ever.
-- `sleeper_cells.army_json` is on the list for a second reason: it arrived in 0102 and
-- `db/repos/sleepers.ts` parses it with no salvage pass at all, so it is the one army column where
-- a stale id still throws on read rather than quietly losing a stack.
--
-- `json_extract` returns NULL for a key that is not there, so every statement here is a no-op on a
-- save that never met him, and running it twice changes nothing.

UPDATE location_control
SET garrison_json = json_remove(
      json_set(garrison_json, '$.directive_xero', json_extract(garrison_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(garrison_json, '$.directive_zero') IS NOT NULL;

UPDATE bases
SET army_json = json_remove(
      json_set(army_json, '$.directive_xero', json_extract(army_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(army_json, '$.directive_zero') IS NOT NULL;

UPDATE missions
SET force_json = json_remove(
      json_set(force_json, '$.directive_xero', json_extract(force_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(force_json, '$.directive_zero') IS NOT NULL;

UPDATE battle_deployments
SET army_json = json_remove(
      json_set(army_json, '$.directive_xero', json_extract(army_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(army_json, '$.directive_zero') IS NOT NULL;

UPDATE battle_deployments
SET perimeter_json = json_remove(
      json_set(perimeter_json, '$.directive_xero',
               json_extract(perimeter_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(perimeter_json, '$.directive_zero') IS NOT NULL;

UPDATE troop_movements
SET army_json = json_remove(
      json_set(army_json, '$.directive_xero', json_extract(army_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(army_json, '$.directive_zero') IS NOT NULL;

UPDATE troop_movements
SET perimeter_json = json_remove(
      json_set(perimeter_json, '$.directive_xero',
               json_extract(perimeter_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(perimeter_json, '$.directive_zero') IS NOT NULL;

UPDATE sleeper_cells
SET army_json = json_remove(
      json_set(army_json, '$.directive_xero', json_extract(army_json, '$.directive_zero')),
      '$.directive_zero')
WHERE json_extract(army_json, '$.directive_zero') IS NOT NULL;

-- The counters and the claim. `REPLACE` is anchored by the `LIKE` so it can only ever rewrite the
-- scope at the end of a key, never a measure that happens to contain the word.
UPDATE crew_tallies
SET tally = REPLACE(tally, ':directive_zero', ':directive_xero')
WHERE tally LIKE '%:directive_zero';

UPDATE crew_feats
SET feat_id = 'directive_xero_slain'
WHERE feat_id = 'directive_zero_slain';
