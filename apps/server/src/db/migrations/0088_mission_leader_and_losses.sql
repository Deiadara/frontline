-- Who led a run, and what a battle job cost (maintainer, 2026-09-10).
--
-- Three columns, because a mission row is per-field rather than one JSON blob and every other
-- thing frozen at launch already has its own.
--
-- `overseer_led` is the other half of `officer_id`. The Overseer is not on the books and has no
-- row in `commanders`, so a run they led could not be recorded at all: it looked exactly like a
-- run nobody led, which is now a thing a crew has to research its way into. 0 for every row
-- already written, which is what they were: officer-led, or unled under the old §G6 rule.
--
-- `lost_json` is the bodies a battle job did not bring home, by unit. A mission never killed
-- anybody before, so `{}` is the honest value for every historical row and the schema's own
-- default reads it the same way.
--
-- `reported` is whether anybody came back to tell it. 1 everywhere, including on the rows this
-- migration is written for: a run that has already settled has already been reported.
ALTER TABLE missions ADD COLUMN overseer_led INTEGER NOT NULL DEFAULT 0;
ALTER TABLE missions ADD COLUMN lost_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE missions ADD COLUMN reported INTEGER NOT NULL DEFAULT 1;
