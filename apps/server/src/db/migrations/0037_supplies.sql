-- Food is called supplies now.
--
-- The rename is a key rename inside two JSON blobs, not a column rename: stockpiles live in
-- `bases.resources_json` and the production remainder lives under `$.productionCarry` in
-- `bases.economy_json`. `ResourcesSchema` has no default for an amount, so a row still carrying
-- `$.food` would throw on its next read rather than loading as zero, which is the behaviour worth
-- keeping: a missing resource stays a real error for every row written after today.
--
-- Both statements are guarded on the old key still being present, so re-running this against a
-- database that has already moved cannot overwrite a stockpile with a null.
UPDATE bases
SET resources_json = json_remove(
      json_set(resources_json, '$.supplies', json_extract(resources_json, '$.food')),
      '$.food'
    )
WHERE json_extract(resources_json, '$.food') IS NOT NULL;

UPDATE bases
SET economy_json = json_remove(
      json_set(
        economy_json,
        '$.productionCarry.supplies',
        json_extract(economy_json, '$.productionCarry.food')
      ),
      '$.productionCarry.food'
    )
WHERE json_extract(economy_json, '$.productionCarry.food') IS NOT NULL;

-- The weekly upkeep cycle is gone with it, so the book no longer carries the week it settled
-- through. `PayrollStateSchema` strips the key on read, so this is tidying rather than a fix.
UPDATE bases
SET economy_json = json_remove(economy_json, '$.payroll.paidThroughAt')
WHERE json_extract(economy_json, '$.payroll.paidThroughAt') IS NOT NULL;
