-- Repairs a stockpile that was written as five nulls, and the save that could not be read after it.
--
-- The cause was arithmetic rather than schema: `buildingEffectiveness` read a `damage` field that
-- was defaulted on the *parser* but absent from any `Building` that had not been through it, so
-- `Math.max(0, undefined)` produced NaN, NaN reached the storage ceiling, the ceiling reached the
-- sandbox's stockpile, and `JSON.stringify` wrote NaN as `null`. `ResourcesSchema` refuses null, so
-- the next boot threw reading a column nothing had knowingly touched, and the server would not
-- start at all.
--
-- Both ends are closed in code now — the arithmetic no longer produces NaN, and the repository
-- refuses to store a non-finite amount — but neither helps a database that is already holding the
-- nulls. This is the only thing that can, and a player should not have to delete their game.
--
-- Repaired to the *starting* stockpile rather than to zero: zero is a real state a crew can be in
-- and would read as a punishment, whereas the opening balance is unambiguously a repair. A district
-- with the sandbox on is raised back to the end-game on the next boot anyway.
--
-- Per field, not per row: only the broken ones move, so a stockpile with four good numbers and one
-- null keeps the four.
--
-- The five literals are `STARTING_RESOURCES`, which SQL cannot import. `stockpile-integrity.test.ts`
-- asserts the repaired row equals that constant, so the two cannot drift apart in silence — which
-- they already had once: these were copied from `0003_economy.sql` and were two values stale by the
-- time anybody looked.

UPDATE bases
SET resources_json = json_set(
    resources_json,
    '$.caps', COALESCE(json_extract(resources_json, '$.caps'), 600),
    '$.food', COALESCE(json_extract(resources_json, '$.food'), 300),
    '$.oil', COALESCE(json_extract(resources_json, '$.oil'), 120),
    '$.scrap', COALESCE(json_extract(resources_json, '$.scrap'), 500),
    '$.highQualityMetal', COALESCE(json_extract(resources_json, '$.highQualityMetal'), 40)
  )
WHERE json_extract(resources_json, '$.caps') IS NULL
   OR json_extract(resources_json, '$.food') IS NULL
   OR json_extract(resources_json, '$.oil') IS NULL
   OR json_extract(resources_json, '$.scrap') IS NULL
   OR json_extract(resources_json, '$.highQualityMetal') IS NULL;
