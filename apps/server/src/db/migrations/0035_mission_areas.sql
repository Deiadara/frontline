-- Missions are per area and go out with actual people in them (`missions.areas.ts`).
--
-- `area_id` is the board the job came off: a district id, or `misc`. It is what closes the other
-- two jobs in that area while a crew is out, so it has to be on the row rather than derived.
-- `force_json` is who went: they leave `bases.army_json` at launch and are merged back on settle.
ALTER TABLE missions ADD COLUMN area_id TEXT NOT NULL DEFAULT 'misc';
ALTER TABLE missions ADD COLUMN force_json TEXT NOT NULL DEFAULT '{}';
