-- A battle report written before the `regular` tier was renamed to `heavy`.
--
-- Stored analyses carry each unit's tier as it was at the time, and the tier vocabulary was renamed
-- without one. `BattleAnalysisSchema.parse` then rejected the row, `resolvedFor` threw, and
-- `GET /battles` answered 500: **one** old report from months ago made the whole battles screen
-- unreachable forever, for that account, with the page showing "Reading the board..." because it
-- drew an error the same way it drew a load.
--
-- The rewrite is exact rather than clever: `regular` became `heavy` (the "regulars" block of
-- `units/catalog.ts` is the heavy tier now), and every other tier name is unchanged. Scoped to the
-- JSON string so a unit id or a name containing the word is untouched.
UPDATE scheduled_battles
SET
  analysis_json = REPLACE(analysis_json, '"tier":"regular"', '"tier":"heavy"')
WHERE
  analysis_json IS NOT NULL
  AND analysis_json LIKE '%"tier":"regular"%';
