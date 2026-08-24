-- The attribute sheet was renamed, and every sheet already written is holding the old keys.
--
-- Nine attributes changed name, one was retired, and two were added. A stored sheet is a JSON
-- object keyed by attribute name, so nothing rejected the old keys on the way in and nothing will
-- reject them on the way out: `AttributesSchema` requires every current name and forbids none of
-- the old ones, so a stale sheet fails validation on read with a message about the *new* keys being
-- absent. That reads as a bug in the schema rather than as old data, which is the worst kind.
--
-- Renames are a plain string swap on the JSON text. The keys are distinctive enough that a
-- substring match cannot collide with a value: every one is quoted and followed by a colon, and no
-- attribute *value* is a string at all.

UPDATE overseers
SET attributes_json = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(replace(attributes_json, '"endurance":', '"stamina":'), '"agility":', '"dexterity":'),
                '"tactics":', '"organization":'
              ),
              '"cunning":', '"logic":'
            ),
            '"scholarship":', '"intuition":'
          ),
          '"vigilance":', '"resolve":'
        ),
        '"imagination":', '"improvisation":'
      ),
      '"appraisal":', '"strategy":'
    ),
    '"mentoring":', '"diplomacy":'
  );

UPDATE bases
SET commanders_json = replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(replace(commanders_json, '"endurance":', '"stamina":'), '"agility":', '"dexterity":'),
                '"tactics":', '"organization":'
              ),
              '"cunning":', '"logic":'
            ),
            '"scholarship":', '"intuition":'
          ),
          '"vigilance":', '"resolve":'
        ),
        '"imagination":', '"improvisation":'
      ),
      '"appraisal":', '"strategy":'
    ),
    '"mentoring":', '"diplomacy":'
  );

-- Marksmanship is gone. `json_remove` is exact here, unlike the string swaps above, because a
-- removal has to take the value with the key and a substring cannot see where the value ends.
UPDATE overseers SET attributes_json = json_remove(attributes_json, '$.marksmanship')
WHERE json_extract(attributes_json, '$.marksmanship') IS NOT NULL;

-- Authority and Cryptography are new. A sheet without them fails validation, so every stored sheet
-- gets them at the recruitment floor rather than at zero: zero is a statement about a person, and
-- these two were never rolled for anybody.
UPDATE overseers
SET attributes_json = json_set(
    attributes_json,
    '$.authority', COALESCE(json_extract(attributes_json, '$.authority'), 12),
    '$.cryptography', COALESCE(json_extract(attributes_json, '$.cryptography'), 12)
  );

-- Officers carry the same sheet, nested one level down inside an array, so the removal and the two
-- additions are done by rebuilding the array rather than by a path expression: `json_remove` cannot
-- reach `$[n].attributes.marksmanship` without knowing `n`, and `n` is different for every crew.
UPDATE bases
SET commanders_json = (
    SELECT json_group_array(
      json_set(
        json_remove(json(value), '$.attributes.marksmanship'),
        '$.attributes.authority', COALESCE(json_extract(value, '$.attributes.authority'), 12),
        '$.attributes.cryptography', COALESCE(json_extract(value, '$.attributes.cryptography'), 12)
      )
    )
    FROM json_each(bases.commanders_json)
  )
WHERE json_array_length(commanders_json) > 0;
