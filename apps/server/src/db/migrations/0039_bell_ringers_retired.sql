-- The Bell-Ringers left the roster, and a save that still names them cannot be read at all.
--
-- The same failure as 0038, one unit later, and it was found the same way: the server would not
-- boot. `UnitIdSchema` is a key schema over the live catalogue, so an army holding a retired id
-- fails `BaseSchema.parse` on the way *out of the database*, before any request is served.
--
-- Every column keyed or filtered by unit id is swept rather than only the ones that happened to be
-- populated on the machine this was found on. A crew that had Bell-Ringers loses them, which is the
-- point: the unit does not exist. `json_remove` is a no-op on a key that is not there, so this is
-- safe against any save.

UPDATE bases
SET army_json = json_remove(army_json, '$.bell_ringers'),
    unit_loadouts_json = CASE
      WHEN unit_loadouts_json IS NULL THEN NULL
      ELSE json_remove(unit_loadouts_json, '$.bell_ringers')
    END;

UPDATE location_control
SET garrison_json = json_remove(garrison_json, '$.bell_ringers');

UPDATE missions
SET force_json = json_remove(force_json, '$.bell_ringers');

UPDATE battle_deployments
SET army_json = json_remove(army_json, '$.bell_ringers'),
    perimeter_json = json_remove(perimeter_json, '$.bell_ringers');

UPDATE troop_movements
SET army_json = json_remove(army_json, '$.bell_ringers'),
    perimeter_json = json_remove(perimeter_json, '$.bell_ringers');

-- The training queue is an array of orders rather than a map, so a retired order is dropped by
-- rebuilding the list without it. Any batch already part-trained goes with it: the units it was
-- going to hand over no longer exist to hand over.
UPDATE bases
SET training_queue_json = (
  SELECT COALESCE(json_group_array(json(entry.value)), '[]')
  FROM json_each(bases.training_queue_json) AS entry
  WHERE json_extract(entry.value, '$.unitId') <> 'bell_ringers'
)
WHERE EXISTS (
  SELECT 1
  FROM json_each(bases.training_queue_json) AS entry
  WHERE json_extract(entry.value, '$.unitId') = 'bell_ringers'
);
