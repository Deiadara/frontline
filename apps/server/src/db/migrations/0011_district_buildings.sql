-- The district — thirteen buildings, modifications and a build queue (GDD §A1).
--
-- Number allocated under INTERFACES.md R6/R9 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- This is a **destructive rename**, and deliberately so. The six MVP structures
-- (`command_center`, `reactor`, `data_hub`, `foundry`, `barracks`, `wall`) were placeholders with
-- no economy behind them; the thirteen that replace them each own one implemented mechanic. Six of
-- the new set are the old set under their real names, so those are remapped rather than dropped
-- and no player loses a level they paid for:
--
--     command_center -> nexus        (it always was the thing that capped everything else)
--     reactor        -> generator    (burns oil, holds up the grid)
--     data_hub       -> lab          (research, ideas, blueprints)
--     foundry        -> scrapyard    (salvage in, materials out)
--     barracks       -> gauntlet     (training)
--     wall           -> gate         (the first thing raiders meet)
--
-- The other seven — quarters, greenhouse, cistern, apothecary, commons, infirmary, garage — are
-- new ground and nobody has one. §D9 made the same destructive call for resources; this follows it.
--
-- Note what is NOT here. `productionSettledAt` is a new key inside `economy_json`, and
-- `EconomyStateSchema` declares it `.nullable().default(null)` precisely so an existing row parses
-- without being rewritten — and null reads as "start the clock now", so no base is handed weeks of
-- back-dated production the first time it is opened. A JSON patch here would have created exactly
-- the back-pay it is designed to avoid.

-- 1. Rename the six, cap them at the new ceiling, and give every structure its (empty) list of
--    fitted modifications. `json_patch` merges over the rebuilt object rather than replacing it,
--    so a structure that somehow already carries `modifications` keeps what it has.
UPDATE bases
SET buildings_json = (
  SELECT json_group_array(
    json(
      json_patch(
        json_object(
          'id', json_extract(value, '$.id'),
          'level', min(json_extract(value, '$.level'), 20),
          'modifications', json('[]'),
          'kind',
            CASE json_extract(value, '$.kind')
              WHEN 'command_center' THEN 'nexus'
              WHEN 'reactor' THEN 'generator'
              WHEN 'data_hub' THEN 'lab'
              WHEN 'foundry' THEN 'scrapyard'
              WHEN 'barracks' THEN 'gauntlet'
              WHEN 'wall' THEN 'gate'
              ELSE json_extract(value, '$.kind')
            END
        ),
        json_object('modifications', json('[]'))
      )
    )
  )
  FROM json_each(bases.buildings_json)
)
WHERE json_array_length(buildings_json) > 0;

-- 2. The build queue. Empty for every existing base, which is the honest reading: nothing was ever
--    queued because until now building was instantaneous.
ALTER TABLE bases ADD COLUMN build_queue_json TEXT NOT NULL DEFAULT '[]';

-- 3. Faction names. `FactionNameSchema` trims and bounds at 40 characters, and the old
--    auto-generated "<username>'s Foothold" can exceed that for a long username — which would fail
--    `BaseSchema.parse` on the next read rather than at the point the name was set. Trimmed to fit
--    rather than reset, so a player keeps a name they recognise and can rename it themselves.
UPDATE bases
SET name = trim(substr(trim(name), 1, 40))
WHERE length(trim(name)) > 40 OR name <> trim(name);
