-- The Consigliere leaves the game (maintainer, 2026-10-01): "Remove the consigliere from the game."
-- A crew's own Master of Whispers defends its ground against spies now, and the chair count is 17.
--
-- Three things in a save name it, handled the way 0108 handled the Scout:
--
-- 1. `bases.commanders_json[].role`. `OfficerRoleSchema` no longer has `consigliere`, so an
--    officer seated there would fail `BaseSchema.parse` and take the whole crew down. They go to
--    the bench (`role: null`), where an officer whose chair no longer exists belongs.
-- 2. `bases.research_json.technologies`. The track's ten rungs are ids the catalogue no longer has,
--    and `feats/snapshot.ts` counts `research_done` off the raw array, so a crew that had finished
--    any would sit ahead on the feats board of what it holds. Dropped.
-- 3. `bases.research_json.active`. A Consigliere rung on the bench would finish into an id nothing
--    reads, and the Lab would draw a project with no track. The project is cleared; what was paid
--    for it is not refunded (pre-launch, maintainer 2026-09-29).
--
-- Every `WHERE` filters on the old value, so a save that never seated one is left byte-identical
-- and a second run does nothing.
UPDATE bases
SET commanders_json = (
  SELECT json_group_array(
    CASE json_extract(officer.value, '$.role')
      WHEN 'consigliere' THEN json_set(officer.value, '$.role', json('null'))
      ELSE json(officer.value)
    END
  )
  FROM json_each(bases.commanders_json) AS officer
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.commanders_json)
  WHERE json_extract(value, '$.role') = 'consigliere'
);

UPDATE bases
SET research_json = json_set(
  research_json,
  '$.technologies',
  (
    SELECT COALESCE(json_group_array(value), json_array())
    FROM json_each(research_json, '$.technologies')
    WHERE value NOT IN (
      'tech_the_quiet_word', 'tech_deniability', 'tech_reading_the_room', 'tech_favours_owed',
      'tech_names_and_faces', 'tech_false_traffic', 'tech_terms_in_advance', 'tech_insulation',
      'tech_the_long_view', 'tech_nothing_in_writing'
    )
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.research_json, '$.technologies')
  WHERE value IN (
    'tech_the_quiet_word', 'tech_deniability', 'tech_reading_the_room', 'tech_favours_owed',
    'tech_names_and_faces', 'tech_false_traffic', 'tech_terms_in_advance', 'tech_insulation',
    'tech_the_long_view', 'tech_nothing_in_writing'
  )
);

UPDATE bases
SET research_json = json_set(research_json, '$.active', json('null'))
WHERE json_extract(research_json, '$.active.project.techId') IN (
  'tech_the_quiet_word', 'tech_deniability', 'tech_reading_the_room', 'tech_favours_owed',
  'tech_names_and_faces', 'tech_false_traffic', 'tech_terms_in_advance', 'tech_insulation',
  'tech_the_long_view', 'tech_nothing_in_writing'
);

-- A spy job is read on the chair as it stood at the send (maintainer, 2026-10-01: "freeze at
-- send"), so the run carries the two numbers its score is made of. Null on runs sent before this,
-- which settle as they always did, off the chair at the settle.
ALTER TABLE spy_runs ADD COLUMN chair_points REAL;
ALTER TABLE spy_runs ADD COLUMN intel_percent REAL;
