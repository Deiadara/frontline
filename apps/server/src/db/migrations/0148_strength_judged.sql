-- The twenty-slot call-off is judged once, at the lock (maintainer, 2026-10-06).
--
-- The check used to run on every tick from the lock to the fight, so a column turned round in its
-- first tenth after the lock could still void a fight that had passed. The flag records that the
-- fight has been judged, and nothing after it is looked at. Zero on every fight already called,
-- which the next tick inside its lock judges once.
ALTER TABLE scheduled_battles ADD COLUMN strength_judged INTEGER NOT NULL DEFAULT 0;
