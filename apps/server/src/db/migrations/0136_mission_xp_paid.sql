-- What a run's return actually banked in XP, bonuses on (bug pass, 2026-10-02).
--
-- `xp` is the job's own figure, frozen at launch, and the award adds the district's and the crew's
-- percentage points when the crew is home. The report printed `xp`, so a crew with +7% read 200 for
-- a run that paid 214. Null on every row settled before this, where the report falls back to `xp`.
ALTER TABLE missions ADD COLUMN xp_paid INTEGER;
