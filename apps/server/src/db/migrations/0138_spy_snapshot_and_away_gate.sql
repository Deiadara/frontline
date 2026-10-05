-- Two spying rulings (maintainer, 2026-10-02).
--
-- A report reads the ground when the runners reach it, not when they get home (P3-B): the read is
-- taken at arrival and kept on the run until it is delivered. Null on a run that has not arrived,
-- and on every run sent before this, which falls back to reading the ground on the way home.
ALTER TABLE spy_runs ADD COLUMN snapshot_json TEXT;
-- A captured gate held by a crew living elsewhere has nobody standing at it between fights (P3-A),
-- so its report says that rather than "empty, 100%".
ALTER TABLE spy_reports ADD COLUMN held_from_away INTEGER NOT NULL DEFAULT 0;
