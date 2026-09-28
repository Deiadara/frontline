-- The grade a card was dealt, frozen on the row when the crew leaves (maintainer, 2026-09-28).
--
-- Replaces the fight tier. Every job is dealt a grade now, plain work as well as fights, and the
-- grade sets the odds, the clock, what a fight fields and what either kind pays, so a row needs it
-- for the same reason it needed the tier: nothing that happens on the road may change the terms.
--
-- A fight already out keeps the weight it left with: each old tier maps to the grade whose fight
-- is nearest the force that tier fielded where it was dealt most. The Siege maps to Mayhem, which
-- inherited its guaranteed page and parts. Plain rows from before this stay null, and the settle
-- reads null as the job's lowest grade.
ALTER TABLE missions ADD COLUMN grade TEXT;

UPDATE missions
SET grade = CASE battle_tier
  WHEN 'fight_1' THEN 'F'
  WHEN 'fight_2' THEN 'E'
  WHEN 'fight_3' THEN 'D+'
  WHEN 'fight_4' THEN 'C+'
  WHEN 'fight_5' THEN 'B+'
  WHEN 'siege' THEN 'S-'
END
WHERE battle_tier IS NOT NULL;

ALTER TABLE missions DROP COLUMN battle_tier;
