-- What a run's return paid besides its haul and XP (bug pass, 2026-10-02): the infamy a battle job
-- earns for the enemy it beat, and the Bone Market's caps for the crew's own dead. Both moved the
-- counters with nothing on the report to say why. Null on every row settled before this, where the
-- report prints neither.
ALTER TABLE missions ADD COLUMN infamy_paid INTEGER;
ALTER TABLE missions ADD COLUMN refund_json TEXT;
