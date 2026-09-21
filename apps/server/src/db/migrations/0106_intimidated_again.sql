-- The same sweep as 0105, because 0105 shipped wrong and is already recorded as applied.
--
-- 0105 was written against `battles.log_json`, which holds `analysis.log`, the array of narrative
-- lines, and not the analysis. So `json_extract(log_json, '$.attacker.cowed')` was NULL on every
-- row and all four of its statements were no-ops. It was corrected in place to sweep
-- `scheduled_battles.analysis_json`, which is where `SiegeRepo.markResolved` writes the report.
--
-- Correcting the file is not enough on its own. The runner keys on the file name, so any database
-- that already ran the broken 0105 has the name in `schema_migrations` and will never run it
-- again, however right the contents now are. Measured on the working save on 2026-09-20: seven
-- resolved reports, five still carrying `cowed`, none carrying `intimidated`, with
-- `0105_intimidated.sql` recorded as applied. Those five would have read back as zero units
-- intimidated for ever.
--
-- So this is a second file with the same body, which is the one thing the runner *will* run. It is
-- deliberately a copy rather than a refactor: a migration is a record of what was done to a
-- database on a day, and the honest record here is that the sweep happened twice because the first
-- one missed.
--
-- A database that never ran the broken 0105 gets the corrected one and then this, and the second
-- does nothing: `json_extract` returns NULL for a key that is not there, so every statement is a
-- no-op once the rename has happened. That is also why this is safe to leave in place for ever.

UPDATE scheduled_battles
SET analysis_json = json_remove(
      json_set(analysis_json, '$.attacker.intimidated',
               json_extract(analysis_json, '$.attacker.cowed')),
      '$.attacker.cowed')
WHERE json_extract(analysis_json, '$.attacker.cowed') IS NOT NULL;

UPDATE scheduled_battles
SET analysis_json = json_remove(
      json_set(analysis_json, '$.defender.intimidated',
               json_extract(analysis_json, '$.defender.cowed')),
      '$.defender.cowed')
WHERE json_extract(analysis_json, '$.defender.cowed') IS NOT NULL;
