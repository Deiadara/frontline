-- "Cowed" is "Intimidated" (maintainer, 2026-09-20), and the stored reports have to come with it.
--
-- The figure is a field on each side of a battle's analysis, and the analysis is written into
-- `scheduled_battles.analysis_json` at the settle (`SiegeRepo.markResolved`) and read back for ever
-- after through `BattleAnalysisSchema` (`SiegeRepo.resolvedFor`). A report is a record of a fight
-- that already happened, so nothing recomputes it.
--
-- `battles.log_json` is not it, and that is worth writing down because it reads as though it should
-- be: the `battles` row is the history entry, but its `log_json` holds `analysis.log`, the array of
-- narrative lines, and nothing else. `0054_battle_report_tiers.sql` swept `analysis_json` for the
-- same reason and is the precedent.
--
-- `SideAnalysisSchema.intimidated` carries `.default(0)`, so an old row would not fail to parse.
-- That is exactly why this is worth doing rather than leaving: a report whose key no longer
-- matches reads back as **zero units intimidated**, silently, on the one screen whose whole job is
-- to explain a fight that looked broken. The figure exists because a line that did a third of its
-- damage with every unit still standing looked like a bug; losing it puts that back.
--
-- `json_extract` returns NULL for a key that is not there, and for the NULL `analysis_json` of a
-- fight that has not run yet, so this is a no-op on a save with no settled battles and on one
-- already carried across, and running it twice changes nothing.

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
