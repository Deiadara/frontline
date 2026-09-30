-- Scouting leaves the game (maintainer, 2026-09-29): "Completely remove scouting from the game."
--
-- The whole city is visible to every crew now, so nothing reads what a crew has seen. What a save
-- still holds from the mechanic goes, and each piece either breaks a read or lies on a screen if
-- it is left alone.

-- The runs, the per-crew record of ground seen, and the Console's per-district fog override.
-- `district_intel` also referenced `bases(id)` without a cascade, which was one of the rows that
-- could block a base being deleted.
DROP TABLE IF EXISTS scouting_runs;
DROP TABLE IF EXISTS district_intel;
DROP TABLE IF EXISTS admin_fog;

-- The bell's retired kind. The list already drops a row whose kind the catalogue no longer carries,
-- so this is tidying rather than a repair.
DELETE FROM notifications WHERE kind = 'scout_home';

-- A muted `scout_home` is a repair: the settings are parsed against the live kinds, and one
-- unknown entry fails the parse and throws away every other switch the player set. Removed as
-- text, because the column is `JSON.stringify` output with no whitespace, and a text rewrite
-- cannot fail on a row that is not valid JSON the way `json_each` would.
UPDATE notification_settings
SET muted_json = replace(
  replace(replace(muted_json, ',"scout_home"', ''), '"scout_home",', ''),
  '"scout_home"',
  ''
)
WHERE muted_json LIKE '%"scout_home"%';

-- The Master of Whispers' first rung was Scouting and is Loose Talk now: same place, price and
-- clock, paying 5% intel. A rung's id comes off its name, so a crew that finished it, or has it on
-- the bench, keeps it under the new id. Both the finished list and the active project are strings
-- inside `research_json`, and the quoted id cannot appear anywhere else in it.
UPDATE bases
SET research_json = replace(research_json, '"tech_scouting"', '"tech_loose_talk"')
WHERE research_json LIKE '%"tech_scouting"%';

-- The feats: two scouting ladders became one ladder of spy jobs home (`spy_jobs_returned`). The old
-- rungs' claims point at ids the catalogue no longer has, and the old counter at a measure it no
-- longer has; both go.
DELETE FROM crew_feats
WHERE feat_id IN (
  'scouted_1', 'scouted_2', 'scouted_3', 'scouted_4',
  'scouting_1', 'scouting_2', 'scouting_3', 'scouting_4',
  'scouting_5', 'scouting_6', 'scouting_7', 'scouting_8'
);
DELETE FROM crew_tallies WHERE tally = 'scouting_runs';

-- ...and the new counter starts where the crew already is. A report is written for every job that
-- came home and for nothing else, and reports are kept for ever, so their count is exactly the
-- number the tally would have reached had it existed from the start. `WHERE true` is SQLite's
-- required disambiguation for an upsert fed by a SELECT.
INSERT INTO crew_tallies (base_id, tally, value)
SELECT base_id, 'spy_jobs_returned', COUNT(*)
FROM spy_reports
WHERE true
GROUP BY base_id
ON CONFLICT (base_id, tally) DO NOTHING;
