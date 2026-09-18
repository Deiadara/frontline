-- A won raid costs the district one penalty, not two (maintainer, 2026-09-18).
--
-- It used to wreck three of the victim's roofs on a 24 hour repair clock *and* disrupt the whole
-- district for six hours. The per-structure half is gone: `damage`, `damagedAt`, the repair walk
-- and everything that read them. The surviving disruption now scales with how badly the defence
-- lost and is capped at half (`raid.ts`).
--
-- `BuildingSchema` no longer declares either field, and Zod strips what it does not declare, so a
-- row this never reached still opens. This is the stored rows tidied rather than a repair: the
-- fields are dropped in place, and a structure that was sitting at 60% wrecked comes back whole,
-- which is what "the mechanic is gone" means. `json_remove` rather than a rebuilt `json_object`,
-- so a row that is missing a field the schema does not require keeps missing it: rebuilding wrote
-- `"id": null` into structures that predate ids and broke migration 0011's own round-trip test.
UPDATE bases
SET buildings_json = (
  SELECT json_group_array(json(json_remove(value, '$.damagedAt', '$.damage')))
  FROM json_each(bases.buildings_json)
)
WHERE json_array_length(buildings_json) > 0;
