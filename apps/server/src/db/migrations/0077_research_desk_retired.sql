-- The Lab's desk is gone, and `research_json` is holding rows the schema no longer accepts.
--
-- `ResearchProjectSchema` is the technology rung and nothing else now: `investigation`, `training`
-- and `modification` are retired. `BaseSchema.parse` runs on every row read (`db/repos/bases.ts`
-- `rowToBase`), so a crew whose desk project was still on the bench when this shipped would fail
-- to parse on *every* read from here on, not once. There is no partial failure to recover from
-- either, because the row is the whole district.
--
-- A retired project is dropped rather than converted. There is nothing to convert it into: an
-- investigation produced facts, which no longer exist; a training project moved the Overseer's
-- sheet, which the Training tab does instead; and a modification produced a drawing, which the
-- Scrapyard now cuts off the structure's retrofit blueprint. What the crew paid is not refunded,
-- for the same reason a mission in flight is not: the clock was the thing they bought.
--
-- `facts` goes with them. Nothing reads it and `ResearchStateSchema` strips it on the way out, so
-- this is housekeeping rather than a correctness fix: it stops every district carrying a dead list
-- that only ever grew.
--
-- Both statements are guarded on what they are about to change, so running this twice is a no-op
-- the second time and running it against a database written after the change touches nothing.

UPDATE bases
SET research_json = json_set(research_json, '$.active', json('null'))
WHERE json_extract(research_json, '$.active.project.kind') IS NOT NULL
  AND json_extract(research_json, '$.active.project.kind') <> 'technology';

UPDATE bases
SET research_json = json_remove(research_json, '$.facts')
WHERE json_type(research_json, '$.facts') IS NOT NULL;
