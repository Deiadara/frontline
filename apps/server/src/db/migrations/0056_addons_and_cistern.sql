-- Two removals and one new shelf, from the buildings patch.
--
-- 1. §A2 retires the Cistern. `BuildingKindSchema` is an enum over the live catalogue, so a saved
--    district that still has one, or an order in the build queue for one, does not fail validation
--    with a bad field: it fails `BaseSchema.parse` on the way *out of the database*, which is the
--    account refusing to open. The readers in `db/repos/bases.ts` are forgiving about both now, and
--    this is the tidy path that fixes the rows that exist today.
--
--    Whatever the Cistern was giving is absorbed rather than lost: the Quarters' beds per level went
--    from 5 to 8 and the housing floor from 16 to 26, and the Greenhouse's yield from 12 to 19.2 an
--    hour, which is each structure's old figure times the 1.6 a maxed Cistern was worth. Nobody's
--    ceiling drops on the day the tank comes down.
--
-- 2. §A1 retires the power grid, and with it two modification effects. A structure carrying
--    `power_supply_percent` or `power_draw_reduction` would keep an id the catalogue no longer
--    knows; `knownBuildings` already filters those on read, and this clears them out for good.
--
-- 3. §B9/§E add `addons_json`: the blueprints the Lab has finished and the add-ons the Scrapyard has
--    built, kept apart from what is *fitted* so a slot has somewhere to empty into. Backfilled from
--    what is already bolted on, so no crew loses a modification it has paid for and every one of
--    them can be taken out and put back.

ALTER TABLE bases ADD COLUMN addons_json TEXT;

-- The shelf: everything currently fitted counts as both researched and built, because it is.
UPDATE bases
SET addons_json = (
  SELECT json_object(
    'researched', COALESCE(json_group_array(mod.value), '[]'),
    'built', COALESCE(json_group_array(mod.value), '[]')
  )
  FROM json_each(bases.buildings_json) AS structure,
       json_each(COALESCE(json_extract(structure.value, '$.modifications'), '[]')) AS mod
)
WHERE addons_json IS NULL;

-- A district with no modifications at all yields NULL from the aggregate above, not an empty
-- object: `json_group_array` over no rows produces no row for the outer SELECT to build from.
UPDATE bases SET addons_json = '{"researched":[],"built":[]}' WHERE addons_json IS NULL;

-- The Cistern's own rows, and any order in flight for one.
UPDATE bases
SET buildings_json = (
  SELECT COALESCE(json_group_array(json(structure.value)), '[]')
  FROM json_each(bases.buildings_json) AS structure
  WHERE json_extract(structure.value, '$.kind') <> 'cistern'
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.buildings_json) AS structure
  WHERE json_extract(structure.value, '$.kind') = 'cistern'
);

UPDATE bases
SET build_queue_json = (
  SELECT COALESCE(json_group_array(json(entry.value)), '[]')
  FROM json_each(bases.build_queue_json) AS entry
  WHERE json_extract(entry.value, '$.kind') <> 'cistern'
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.build_queue_json) AS entry
  WHERE json_extract(entry.value, '$.kind') = 'cistern'
);
