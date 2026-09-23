-- Two columns nothing reads or writes (dead-code pass, 2026-09-24).
--
-- `battle_deployments.boost_id` was superseded by `boost_ids_json` in 0091, which backfilled it
-- with `json_array(boost_id)` and left the old column behind; `sieges.ts` has read and written
-- only the JSON since. One test was still inserting into it, which is a trap for the next person
-- reading that repo: a column something writes looks like a column something reads.
--
-- `location_control.trap_json` has had no reader or writer since 0078 moved traps onto the
-- deployment. That migration left it deliberately, because dropping a column rewrites the table
-- and it judged the nulls not worth the rewrite. The game has never shipped, so there is no save
-- worth protecting from a rewrite, and the maintainer's call (2026-09-24) is to take both.
--
-- SQLite rewrites the table for each of these. Both tables are small and this runs once.
ALTER TABLE battle_deployments DROP COLUMN boost_id;
ALTER TABLE location_control DROP COLUMN trap_json;
