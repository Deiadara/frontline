-- A fight job's tier, frozen on the row when the crew leaves (maintainer, 2026-09-23).
--
-- Dealt on the card off the crew's level rather than read off the template, so it has to be
-- kept: a level gained on the road must not change what is waiting for the crew or what it pays.
-- Null on plain work and on every fight row written before this, which the settle reads as a
-- Fight I, the bottom of the ladder and the pay those rows were quoted.
ALTER TABLE missions ADD COLUMN battle_tier TEXT;
