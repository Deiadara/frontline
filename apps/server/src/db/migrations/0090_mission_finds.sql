-- What a crew turned up, as opposed to what it was paid (maintainer request, 2026-09-12).
--
-- Salvage went straight into the satchel and was never written down, so the mission report could
-- say what the run earned and not what it *found*: the servo, the page, the relic, which is the
-- half of a run a player actually remembers. `{}` for every row already written, which is what
-- those reports can honestly say.
ALTER TABLE missions ADD COLUMN found_json TEXT NOT NULL DEFAULT '{}';
