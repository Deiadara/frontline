-- Three units left the roster (Muckrakers, Jammers, Wrecking Crew), and a save that still names
-- one cannot be read at all.
--
-- `UnitIdSchema` is a key schema over the live catalogue, so an army holding a retired id fails
-- `BaseSchema.parse` on the way *out of the database*: the server did not serve a bad response,
-- it refused to boot. Every column below is keyed or filtered by unit id, so every one of them
-- has to be swept, not only the two that happened to be populated on the machine this was found
-- on. A crew that had Muckrakers loses them, which is the point: the unit does not exist.
--
-- `json_remove` is a no-op on a key that is not there, so this is safe to run against any save.

UPDATE bases
SET army_json = json_remove(army_json, '$.muckrakers', '$.jammers', '$.wrecking_crew'),
    unit_loadouts_json = CASE
      WHEN unit_loadouts_json IS NULL THEN NULL
      ELSE json_remove(unit_loadouts_json, '$.muckrakers', '$.jammers', '$.wrecking_crew')
    END;

UPDATE location_control
SET garrison_json = json_remove(garrison_json, '$.muckrakers', '$.jammers', '$.wrecking_crew');

UPDATE missions
SET force_json = json_remove(force_json, '$.muckrakers', '$.jammers', '$.wrecking_crew');

UPDATE battle_deployments
SET army_json = json_remove(army_json, '$.muckrakers', '$.jammers', '$.wrecking_crew'),
    perimeter_json = json_remove(perimeter_json, '$.muckrakers', '$.jammers', '$.wrecking_crew');

UPDATE troop_movements
SET army_json = json_remove(army_json, '$.muckrakers', '$.jammers', '$.wrecking_crew'),
    perimeter_json = json_remove(perimeter_json, '$.muckrakers', '$.jammers', '$.wrecking_crew');

-- The training queue is an array of orders rather than a map, so a retired order is dropped by
-- rebuilding the list without it. Any batch already part-trained goes with it: the units it was
-- going to hand over no longer exist to hand over.
UPDATE bases
SET training_queue_json = (
  SELECT COALESCE(json_group_array(json(entry.value)), '[]')
  FROM json_each(bases.training_queue_json) AS entry
  WHERE json_extract(entry.value, '$.unitId') NOT IN ('muckrakers', 'jammers', 'wrecking_crew')
)
WHERE EXISTS (
  SELECT 1
  FROM json_each(bases.training_queue_json) AS entry
  WHERE json_extract(entry.value, '$.unitId') IN ('muckrakers', 'jammers', 'wrecking_crew')
);
