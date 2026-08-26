-- The terms a crew went out under, frozen on the row beside the clock and the odds.
--
-- `pay_percent` is the ground's premium plus the crew's level at launch; `xp` is what a clean run
-- of this job pays. Both were read live at settle time, which made the payout depend on *when* the
-- settle happened: a player who watched their fleet come home was paid differently from one who
-- slept through it, because levelling mid-fleet moved the premium under the later crews.
ALTER TABLE missions ADD COLUMN pay_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE missions ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
