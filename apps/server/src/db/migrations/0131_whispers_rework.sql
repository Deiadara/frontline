-- The Master of Whispers' track, redone from the maintainer's ledger (2026-09-28).
--
-- Three rungs change id with their names, and a crew keeps the step it reached:
--
-- - rung 1, Loose Talk (0130), is Written Reports: `tech_loose_talk` -> `tech_written_reports`;
-- - rung 8, Turned Runners, is Shared Knowledge: `tech_turned_runners` -> `tech_shared_knowledge`;
-- - rung 9, Compartmentation, takes the name Turned Runners and its id:
--   `tech_compartmentation` -> `tech_turned_runners`.
--
-- The order of the last two is the whole point: the old rung 8 has to be off `tech_turned_runners`
-- before the old rung 9 moves onto it, or a crew holding both would end up with rung 9 twice and
-- rung 8 not at all. The finished list and the active project are strings inside `research_json`,
-- and a quoted id cannot appear anywhere else in it, so a text replace is exact (0130 does the same).
UPDATE bases
SET research_json = replace(research_json, '"tech_loose_talk"', '"tech_written_reports"')
WHERE research_json LIKE '%"tech_loose_talk"%';

UPDATE bases
SET research_json = replace(research_json, '"tech_turned_runners"', '"tech_shared_knowledge"')
WHERE research_json LIKE '%"tech_turned_runners"%';

UPDATE bases
SET research_json = replace(research_json, '"tech_compartmentation"', '"tech_turned_runners"')
WHERE research_json LIKE '%"tech_compartmentation"%';

-- What a report says moved with the track, so the report carries four more facts, and one it had
-- becomes optional:
--
-- - `tier` is null on the report the Turned Runners courier brings in, which nobody paid for;
-- - `exposed_slots`: the unit slots of what was seen, which is all a report says before Written
--   Reports. Null on the rows below, which were written with the units named; the repository
--   counts them off `exposed_json` on read, since the unit catalogue is not something SQL can see;
-- - `units_shown`: whether `exposed_json` names units. Every report before today did;
-- - `total_slots`: the exact slots standing there, from The Whole Wire. Nobody had it before;
-- - `found_out`: whether the holder was told who came. Unknown for old rows, and false is the
--   reading that claims nothing.
--
-- SQLite cannot drop a NOT NULL, so the table is rebuilt the way 0127 rebuilt it.
CREATE TABLE spy_reports_new (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  target_json    TEXT NOT NULL,
  district_id    TEXT NOT NULL,
  district_name  TEXT NOT NULL,
  place_name     TEXT NOT NULL,
  holder_json    TEXT NOT NULL,
  tier           TEXT,
  caps_paid      INTEGER NOT NULL,
  written_at     TEXT NOT NULL,
  failed         INTEGER NOT NULL DEFAULT 0,
  exposed_json   TEXT NOT NULL,
  accuracy       REAL,
  unseen         INTEGER,
  accuracy_shown INTEGER NOT NULL DEFAULT 0,
  exposed_slots  INTEGER,
  units_shown    INTEGER NOT NULL DEFAULT 1,
  total_slots    INTEGER,
  found_out      INTEGER NOT NULL DEFAULT 0
);
INSERT INTO spy_reports_new
  (id, base_id, target_json, district_id, district_name, place_name, holder_json, tier,
   caps_paid, written_at, failed, exposed_json, accuracy, unseen, accuracy_shown)
SELECT id, base_id, target_json, district_id, district_name, place_name, holder_json, tier,
  caps_paid, written_at, failed, exposed_json, accuracy, unseen, accuracy_shown
FROM spy_reports;
DROP TABLE spy_reports;
ALTER TABLE spy_reports_new RENAME TO spy_reports;
CREATE INDEX spy_reports_base ON spy_reports (base_id, written_at);
