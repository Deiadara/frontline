-- The real economy (MOU-161, GDD §D).
--
-- Destructive by board decision (§D9): the MVP's credits/power/data/alloy are *replaced* by
-- caps/food/oil/scrap/high-quality metal, and every stockpile is reset to the new starting
-- values rather than converted. There is no live player data to preserve.
--
-- `economy_json` holds the morale and infamy meters (§D4, §D7), the tallied actions reputation
-- is derived from (§D8) and the wage book the weekly payroll settles (§H7). It is validated by
-- `EconomyStateSchema` on read.
--
-- The literals below are a snapshot of STARTING_RESOURCES / startingEconomy() as of this
-- migration, on purpose: a migration must keep describing the past even after those constants
-- move on.
--
-- INTERFACES.md R6: this file shares the `0003` prefix with `0003_attribute_model.sql`, which
-- sorts first and DELETEs every `bases` row — so the backfill below is a no-op in a combined
-- run and only matters to a database that ran the old schema alone. The column DEFAULT is not a
-- valid `EconomyState`, so the *fresh-insert* path is what has to produce one; `bases.ts` always
-- writes `economy_json` explicitly, and `settle.test.ts` pins the round trip. Do not renumber:
-- the runner keys `schema_migrations` on the file name.

ALTER TABLE bases ADD COLUMN economy_json TEXT NOT NULL DEFAULT '{}';

UPDATE bases
SET resources_json = '{"caps":500,"food":300,"oil":120,"scrap":200,"highQualityMetal":40}',
    economy_json =
      '{"morale":60,"infamy":0,"reputationTally":{"updatedAt":"'
      || strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      || '","raidsWon":0,"raidsLost":0},"payroll":{"paidThroughAt":"'
      || strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      || '","wages":{}}}';

-- Rewards banked in currencies that no longer exist would decode into an empty bundle anyway.
UPDATE battles SET rewards_json = '{}';
