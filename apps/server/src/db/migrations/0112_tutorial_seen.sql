-- The opening tutorial's memory, on the account (2026-09-22).
--
-- Which cards this player has already been shown, as a JSON array of step ids. Skipping the
-- tutorial writes every id in, so "skipped" and "seen them all" are one state rather than two
-- flags that can disagree.
--
-- On the account rather than the base: a player who starts a second crew has still been told what
-- a district is, and a tutorial that plays again on a second machine reads as a bug.
ALTER TABLE users ADD COLUMN tutorial_seen_json TEXT;
