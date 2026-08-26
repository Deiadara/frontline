-- §D5b: planks, the sixth resource.
--
-- Stockpiles live in `bases.resources_json` and are read back through `ResourcesSchema.parse`,
-- which has no default for an amount: a row written before this migration has no `planks` key and
-- would throw on the next read rather than quietly loading as zero. So the key is backfilled here
-- instead of being defaulted in the schema, which keeps a missing resource a real error for every
-- row written after today.
--
-- `json_set` only touches rows that are actually missing the key, so re-running this against a
-- database that already has it cannot overwrite a stockpile.
UPDATE bases
SET resources_json = json_set(resources_json, '$.planks', 0)
WHERE json_extract(resources_json, '$.planks') IS NULL;
