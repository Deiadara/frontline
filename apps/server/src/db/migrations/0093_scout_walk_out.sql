-- The walk out, frozen on a scouting run (bug pass, 2026-09-13).
--
-- A recall is the first tenth of the way out, and the way out is the walk. The mark on the row is
-- the whole run, which is the walk twice plus the hours the officer spends looking, so half the
-- mark overstated the leg by half the looking: anything from twenty minutes to two hours. With a
-- slow officer on near ground the window stayed open long after the scout had arrived, and the
-- walk home was then charged as time elapsed rather than as distance covered.
--
-- Backfilled with the figure the old arithmetic produced, so a run already on the road keeps the
-- window its owner can currently see rather than losing it mid-flight. Recalled and settled rows
-- are backfilled too and never read it: `scoutRecallable` refuses a run already turned round.
ALTER TABLE scouting_runs ADD COLUMN travel_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE scouting_runs
SET travel_minutes = CAST(
  ((julianday(returns_at) - julianday(departed_at)) * 1440) / 2 AS INTEGER
);
