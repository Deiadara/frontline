-- Player XP and levelling (MOU-165, GDD §I).
--
-- The player's level is the pre-existing `bases.level` column and stays there (INTERFACES §2 R1):
-- this migration adds only the XP banked towards the *next* level. There is deliberately no
-- lifetime-XP total — that would make `level` derivable and let the two drift apart.
--
-- INTERFACES §2 R8 allocated this the `0005` prefix; `0004_missions.sql` (W3) sorts first but the
-- two land independently, so per R6 nothing below reads a column `0004` adds — this touches only
-- `bases`, which has existed since `0001_init.sql`.
--
-- Unlike `0003_economy.sql`, the DEFAULT here is a *valid* `ProgressionState`, not `'{}'`. SQLite
-- backfills existing rows with it on ADD COLUMN, so both the migrated and the fresh-insert path
-- produce something `ProgressionStateSchema` accepts and no separate UPDATE is needed. The literal
-- is a snapshot of `startingProgression()` as of this migration, on purpose: a migration must keep
-- describing the past even after that constant moves on.

ALTER TABLE bases ADD COLUMN progression_json TEXT NOT NULL DEFAULT '{"xpIntoLevel":0}';
