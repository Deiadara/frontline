-- A spy report's accuracy is null wherever the reader has not earned it (bug pass, 2026-09-28).
--
-- The figure was written on every report and sent on every read, with only the screen declining to
-- print it. `exposed` divided by it is the whole count standing on the ground, so a crew without
-- the accuracy rung could read the true size of a garrison off the wire, and the unseen estimate
-- behind its own rung came along for free. The same went for a failed report, whose accuracy and
-- estimate together give back the count its empty `exposed` withholds.
--
-- SQLite cannot drop a NOT NULL, so the table is rebuilt as 0108 rebuilt `scouting_runs`, and the
-- figures nobody was entitled to are cleared from the reports already written.
CREATE TABLE spy_reports_new (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  target_json    TEXT NOT NULL,
  district_id    TEXT NOT NULL,
  district_name  TEXT NOT NULL,
  place_name     TEXT NOT NULL,
  holder_json    TEXT NOT NULL,
  tier           TEXT NOT NULL,
  caps_paid      INTEGER NOT NULL,
  written_at     TEXT NOT NULL,
  failed         INTEGER NOT NULL DEFAULT 0,
  exposed_json   TEXT NOT NULL,
  accuracy       REAL,
  unseen         INTEGER,
  accuracy_shown INTEGER NOT NULL DEFAULT 0
);
INSERT INTO spy_reports_new
  (id, base_id, target_json, district_id, district_name, place_name, holder_json, tier,
   caps_paid, written_at, failed, exposed_json, accuracy, unseen, accuracy_shown)
SELECT id, base_id, target_json, district_id, district_name, place_name, holder_json, tier,
  caps_paid, written_at, failed, exposed_json,
  CASE WHEN accuracy_shown = 1 AND failed = 0 THEN accuracy END,
  CASE WHEN failed = 0 THEN unseen END,
  accuracy_shown
FROM spy_reports;
DROP TABLE spy_reports;
ALTER TABLE spy_reports_new RENAME TO spy_reports;
CREATE INDEX spy_reports_base ON spy_reports (base_id, written_at);
