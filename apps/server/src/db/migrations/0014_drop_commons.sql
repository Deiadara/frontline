-- The Commons left the game. A district saved before it did still carries one.
--
-- Buildings are stored as JSON, so nothing rejected the row on the way in and nothing will reject it
-- on the way out: it comes back as a `Building` whose `kind` is not in `BUILDING_KINDS`, and the
-- first `BUILDING_CATALOG[kind]` lookup downstream reads `undefined` off it. That is a crash in the
-- district view and a silently wrong number in production and morale — for a structure the player
-- can no longer see, build or remove. Deleting the row is the only state the rest of the code can
-- represent.
--
-- Rebuilt through `json_each` rather than patched with `json_remove`, whose paths are positional:
-- `$[8]` is only the Commons until somebody's save has a different build order.

UPDATE bases
SET buildings_json = (
    SELECT json_group_array(json(value))
    FROM json_each(bases.buildings_json)
    WHERE json_extract(value, '$.kind') <> 'commons'
  )
WHERE EXISTS (
    SELECT 1 FROM json_each(bases.buildings_json)
    WHERE json_extract(value, '$.kind') = 'commons'
  );

-- ...and anything queued to build one, which would otherwise complete into the row just deleted.
UPDATE bases
SET build_queue_json = (
    SELECT json_group_array(json(value))
    FROM json_each(bases.build_queue_json)
    WHERE json_extract(value, '$.kind') <> 'commons'
  )
WHERE EXISTS (
    SELECT 1 FROM json_each(bases.build_queue_json)
    WHERE json_extract(value, '$.kind') = 'commons'
  );

-- The Cistern's fifth modification was renamed when the morale it fed moved to the Quarters. Its id
-- is derived from its name, so an installed copy is now an id `findModification` does not know —
-- which reads as "not installed" and quietly hands the player back a slot they already spent.
UPDATE bases
SET buildings_json = replace(
    buildings_json,
    'cistern_clean_line_to_the_commons',
    'cistern_clean_line_to_the_quarters'
  )
WHERE buildings_json LIKE '%cistern_clean_line_to_the_commons%';
