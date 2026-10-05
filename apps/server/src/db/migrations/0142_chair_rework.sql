-- The chair rework (maintainer, 2026-10-04). Four chairs leave the game (the Wetware Chief, the
-- Fabricator, the Chief Medic and the Instructor of the Young), five are renamed, and the Head of
-- Security becomes the Veteran with a mustering track. Handled the way 0108 and 0135 handled the
-- Scout and the Consigliere:
--
-- 1. `bases.commanders_json[].role`. `OfficerRoleSchema` is an enum over the live role list, so an
--    old id fails `BaseSchema.parse` and takes the crew down. Renamed chairs keep their officer
--    under the new id; an officer in a removed chair goes to the bench (`role: null`).
-- 2. `bases.research_json.technologies`. Rungs the catalogue no longer has are dropped. The rungs
--    that moved to a surviving track (Batch Runs, Reimagining, Carry Both and the Instructor's
--    mustering rungs) kept their ids and are kept.
-- 3. `bases.research_json.active`. A project on a dropped rung is cleared, not refunded
--    (pre-launch, maintainer 2026-09-29).
--
-- Every `WHERE` filters on the old values, so a save with none of them is left byte-identical.
UPDATE bases
SET commanders_json = (
  SELECT json_group_array(
    CASE json_extract(officer.value, '$.role')
      WHEN 'lead_engineer' THEN json_set(officer.value, '$.role', 'engineer')
      WHEN 'finance_officer' THEN json_set(officer.value, '$.role', 'fixer')
      WHEN 'head_of_growth' THEN json_set(officer.value, '$.role', 'steward')
      WHEN 'head_of_research' THEN json_set(officer.value, '$.role', 'researcher')
      WHEN 'security_officer' THEN json_set(officer.value, '$.role', 'veteran')
      WHEN 'wetware_chief' THEN json_set(officer.value, '$.role', json('null'))
      WHEN 'fabricator' THEN json_set(officer.value, '$.role', json('null'))
      WHEN 'chief_medic' THEN json_set(officer.value, '$.role', json('null'))
      WHEN 'instructor_of_the_young' THEN json_set(officer.value, '$.role', json('null'))
      ELSE json(officer.value)
    END
  )
  FROM json_each(bases.commanders_json) AS officer
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.commanders_json)
  WHERE json_extract(value, '$.role') IN (
    'lead_engineer', 'finance_officer', 'head_of_growth', 'head_of_research', 'security_officer',
    'wetware_chief', 'fabricator', 'chief_medic', 'instructor_of_the_young'
  )
);

UPDATE bases
SET research_json = json_set(
  research_json,
  '$.technologies',
  (
    SELECT COALESCE(json_group_array(value), json_array())
    FROM json_each(research_json, '$.technologies')
    WHERE value NOT IN (
  'tech_formwork_reuse', 'tech_clean_room', 'tech_nerve_mapping', 'tech_rejection_protocols',
  'tech_reflex_shunts', 'tech_load_bearing_frames', 'tech_pain_gating', 'tech_subdermal_plate',
  'tech_salvage_grafts', 'tech_neural_redundancy', 'tech_the_second_body',
  'tech_jigs_and_fixtures', 'tech_tool_steel', 'tech_standard_parts', 'tech_cold_forming',
  'tech_investment_casting', 'tech_hard_chrome', 'tech_numerical_control',
  'tech_the_master_pattern', 'tech_dry_storage', 'tech_pressure_plates', 'tech_watch_schedules',
  'tech_sally_ports', 'tech_shaped_charges', 'tech_vetting', 'tech_demolition_doctrine',
  'tech_layered_defence', 'tech_counter_surveillance', 'tech_the_hard_district',
  'tech_field_triage', 'tech_clean_water', 'tech_stretcher_drill', 'tech_blood_bank',
  'tech_antiseptics', 'tech_trauma_theatre', 'tech_convalescence', 'tech_prosthetics_bench',
  'tech_nobody_left', 'tech_section_leaders', 'tech_night_exercises'
    )
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.research_json, '$.technologies')
  WHERE value IN (
  'tech_formwork_reuse', 'tech_clean_room', 'tech_nerve_mapping', 'tech_rejection_protocols',
  'tech_reflex_shunts', 'tech_load_bearing_frames', 'tech_pain_gating', 'tech_subdermal_plate',
  'tech_salvage_grafts', 'tech_neural_redundancy', 'tech_the_second_body',
  'tech_jigs_and_fixtures', 'tech_tool_steel', 'tech_standard_parts', 'tech_cold_forming',
  'tech_investment_casting', 'tech_hard_chrome', 'tech_numerical_control',
  'tech_the_master_pattern', 'tech_dry_storage', 'tech_pressure_plates', 'tech_watch_schedules',
  'tech_sally_ports', 'tech_shaped_charges', 'tech_vetting', 'tech_demolition_doctrine',
  'tech_layered_defence', 'tech_counter_surveillance', 'tech_the_hard_district',
  'tech_field_triage', 'tech_clean_water', 'tech_stretcher_drill', 'tech_blood_bank',
  'tech_antiseptics', 'tech_trauma_theatre', 'tech_convalescence', 'tech_prosthetics_bench',
  'tech_nobody_left', 'tech_section_leaders', 'tech_night_exercises'
  )
);

UPDATE bases
SET research_json = json_set(research_json, '$.active', json('null'))
WHERE json_extract(research_json, '$.active.project.techId') IN (
  'tech_formwork_reuse', 'tech_clean_room', 'tech_nerve_mapping', 'tech_rejection_protocols',
  'tech_reflex_shunts', 'tech_load_bearing_frames', 'tech_pain_gating', 'tech_subdermal_plate',
  'tech_salvage_grafts', 'tech_neural_redundancy', 'tech_the_second_body',
  'tech_jigs_and_fixtures', 'tech_tool_steel', 'tech_standard_parts', 'tech_cold_forming',
  'tech_investment_casting', 'tech_hard_chrome', 'tech_numerical_control',
  'tech_the_master_pattern', 'tech_dry_storage', 'tech_pressure_plates', 'tech_watch_schedules',
  'tech_sally_ports', 'tech_shaped_charges', 'tech_vetting', 'tech_demolition_doctrine',
  'tech_layered_defence', 'tech_counter_surveillance', 'tech_the_hard_district',
  'tech_field_triage', 'tech_clean_water', 'tech_stretcher_drill', 'tech_blood_bank',
  'tech_antiseptics', 'tech_trauma_theatre', 'tech_convalescence', 'tech_prosthetics_bench',
  'tech_nobody_left', 'tech_section_leaders', 'tech_night_exercises'
);
