-- The Head Spy is the Master of Whispers, and the Scout's chair is gone (maintainer, 2026-09-22).
--
-- Three things in a save name either, and each breaks differently if left alone.
--
-- 1. `bases.commanders_json[].role`. `OfficerRoleSchema` is an enum over the live role list, so
--    an officer sitting as `head_spy` or `scout` is an unparseable row: `BaseSchema.parse` throws
--    on the way out of the database and the server will not serve the crew at all. The Master of
--    Whispers keeps the chair under the new name; the Scout goes to the bench (`role: null`),
--    which is where an officer whose chair no longer exists belongs, and is what the Crew screen
--    already draws for anybody unseated.
-- 2. `bases.research_json.technologies`. The Scout's ten rungs are ids the catalogue no longer
--    has. Nothing throws over them, but `feats/snapshot.ts` counts `research_done` off the raw
--    array and the Lab counts off the catalogue, so a crew that had finished any of them would
--    be up to ten programmes ahead on the feats board of what it holds. Dropped, as the retired
--    Professor rung was in 0107. The Master of Whispers' rungs keep their ids: a rung's id comes
--    off its name (`idOf`), not its track, and the names are unchanged today; the track's rework
--    is a later migration's business.
-- 3. The research *track* id is the role id, but it is never stored: `ResearchItemSpec.track`
--    is derived from the catalogue at read time. Nothing to rewrite.
--
-- `json_extract` on a key that is not there is NULL and every `WHERE` here filters on the old
-- value, so a save that never seated either is left byte-identical and a second run does nothing.

UPDATE bases
SET commanders_json = (
  SELECT json_group_array(
    CASE json_extract(officer.value, '$.role')
      WHEN 'head_spy' THEN json_set(officer.value, '$.role', 'master_of_whispers')
      WHEN 'scout' THEN json_set(officer.value, '$.role', json('null'))
      ELSE json(officer.value)
    END
  )
  FROM json_each(bases.commanders_json) AS officer
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.commanders_json)
  WHERE json_extract(value, '$.role') IN ('head_spy', 'scout')
);

UPDATE bases
SET research_json = json_set(
  research_json,
  '$.technologies',
  (
    SELECT COALESCE(json_group_array(value), json_array())
    FROM json_each(research_json, '$.technologies')
    WHERE value NOT IN (
      'tech_point_work', 'tech_pace_counting', 'tech_observation_posts', 'tech_track_reading',
      'tech_light_order', 'tech_hide_discipline', 'tech_runner_relays',
      'tech_route_reconnaissance', 'tech_counter_tracking', 'tech_eyes_on'
    )
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.research_json, '$.technologies')
  WHERE value IN (
    'tech_point_work', 'tech_pace_counting', 'tech_observation_posts', 'tech_track_reading',
    'tech_light_order', 'tech_hide_discipline', 'tech_runner_relays',
    'tech_route_reconnaissance', 'tech_counter_tracking', 'tech_eyes_on'
  )
);

-- And the run itself carries nobody. `officer_id` was NOT NULL because a run was an officer's
-- journey; a scout party is the Master of Whispers' people and the column is null on every run
-- sent from here on. SQLite cannot drop a NOT NULL, so the table is rebuilt, rows carried over
-- (an old run still names who went and settles as it always did), and both indexes re-cut.
CREATE TABLE scouting_runs_new (
  id           TEXT PRIMARY KEY,
  base_id      TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  district_id  TEXT NOT NULL,
  officer_id   TEXT,
  departed_at  TEXT NOT NULL,
  returns_at   TEXT NOT NULL,
  settled_at   TEXT,
  travel_minutes INTEGER NOT NULL DEFAULT 0,
  recalled_at  TEXT
);
INSERT INTO scouting_runs_new
  (id, base_id, district_id, officer_id, departed_at, returns_at, settled_at, travel_minutes, recalled_at)
SELECT id, base_id, district_id, officer_id, departed_at, returns_at, settled_at, travel_minutes, recalled_at
FROM scouting_runs;
DROP TABLE scouting_runs;
ALTER TABLE scouting_runs_new RENAME TO scouting_runs;
CREATE INDEX scouting_runs_due ON scouting_runs (settled_at, returns_at);
CREATE INDEX scouting_runs_base ON scouting_runs (base_id, settled_at);
