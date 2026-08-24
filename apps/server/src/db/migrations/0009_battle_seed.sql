-- The battle roll became deterministic (docs/ARCHITECTURE.md, "Battle engine"): a battle is
-- resolved from its seed, so the seed has to survive on the row for the fight to replay.
--
-- Nullable on purpose. Rows written before this migration were resolved by the old 50/50 coin
-- flip, which read no seed and no inputs. There is no value that would replay them, and inventing
-- one would claim a reproducibility they never had. NULL reads as "pre-model, not replayable",
-- and the history is kept rather than deleted.
ALTER TABLE battles ADD COLUMN seed TEXT;
