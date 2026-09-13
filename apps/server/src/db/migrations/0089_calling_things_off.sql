-- Calling things off (maintainer request, 2026-09-12): one rule, everything that takes time.
--
-- A scout turned round in the first tenth of the way out walks home the distance covered and the
-- ground does not open: `recalled_at` is what tells the settler not to open it. NULL for every
-- run already written, which is every run that was never turned round.
ALTER TABLE scouting_runs ADD COLUMN recalled_at TEXT;

-- A captured gate's raise can be called off in its first tenth, and the tenth is measured from
-- when it began, not backwards from when it lands: the Generator's burn shortens the clock and
-- the end alone cannot say how long it was. NULL for rows in flight, which cannot be cancelled
-- and finish as they were going to.
ALTER TABLE captured_gates ADD COLUMN upgrading_since TEXT;
