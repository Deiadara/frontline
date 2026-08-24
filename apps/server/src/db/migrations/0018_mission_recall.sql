-- A crew can be turned around now, and the moment the order reached them is the whole record of it.
--
-- Nullable, and null is the normal case: almost every mission is left to finish. The return leg is
-- *derived* from this and `started_at` rather than written into `travel_minutes`: overwriting the
-- clock would destroy the record of how long the run was supposed to take, which is the one thing
-- the report afterwards wants to say.

ALTER TABLE missions ADD COLUMN recalled_at TEXT;
