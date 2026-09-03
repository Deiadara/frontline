-- Three technical attributes changed, and every sheet already written is holding the old keys.
--
-- Same shape as 0015, and the same reason: a stored sheet is a JSON object keyed by attribute name,
-- so nothing rejected the old keys on the way in and nothing rejects them on the way out.
-- `AttributesSchema` requires every current name, so a stale sheet fails validation on read with a
-- message about the *new* keys being absent, which reads as a bug in the schema rather than as old
-- data.
--
-- Two of the three are renames and carry their value:
--
--   hacking     -> signals   the same trade, named for the whole of it rather than for breaking in
--   fabrication -> craft     the same hands, wider than a bench
--
-- The third is not a rename. `demolition` is retired and `encyclopedia` replaces the slot, so the
-- value does not carry: somebody rated 60 at placing charges has not read anything, and moving the
-- number across would hand every raid boss in the game a scholar's sheet. Retired like
-- `marksmanship` in 0015, and the replacement arrives at the recruitment floor like `authority` and
-- `cryptography` did there, for the same reason: zero is a statement about a person, and nobody was
-- ever rolled for this one.

-- Renames are a plain string swap on the JSON text. Every key is quoted and followed by a colon,
-- and no attribute *value* is a string, so a substring match cannot collide with one.
UPDATE overseers
SET attributes_json = replace(
    replace(attributes_json, '"hacking":', '"signals":'),
    '"fabrication":', '"craft":'
  );

UPDATE bases
SET commanders_json = replace(
    replace(commanders_json, '"hacking":', '"signals":'),
    '"fabrication":', '"craft":'
  );

-- The retirement takes the value with the key, which a substring cannot do: `json_remove` knows
-- where the value ends and a `replace` does not.
UPDATE overseers SET attributes_json = json_remove(attributes_json, '$.demolition')
WHERE json_extract(attributes_json, '$.demolition') IS NOT NULL;

UPDATE overseers
SET attributes_json = json_set(
    attributes_json,
    '$.encyclopedia', COALESCE(json_extract(attributes_json, '$.encyclopedia'), 12)
  );

-- Officers carry the same sheet nested one level down inside an array, so the removal and the
-- addition rebuild the array rather than using a path: `json_remove` cannot reach
-- `$[n].attributes.demolition` without knowing `n`, and `n` differs for every crew.
UPDATE bases
SET commanders_json = (
    SELECT json_group_array(
      json_set(
        json_remove(json(value), '$.attributes.demolition'),
        '$.attributes.encyclopedia', COALESCE(json_extract(value, '$.attributes.encyclopedia'), 12)
      )
    )
    FROM json_each(bases.commanders_json)
  )
WHERE json_array_length(commanders_json) > 0;
