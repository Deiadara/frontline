-- What a run's crew could lift between them, as the settle worked it out at the mark (bug pass,
-- 2026-10-06). The report recomputed it from today's loadouts, bag and marks, and could read "all
-- 300 of it, out of the 200 they could lift". Null on every row settled before this, where the
-- report drops the "out of" clause.
ALTER TABLE missions ADD COLUMN carry_capacity REAL;
