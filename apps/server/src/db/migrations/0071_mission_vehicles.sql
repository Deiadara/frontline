-- §C3: the machines a crew took with them on a run.
--
-- Its own column rather than a field folded into `force_json`, for the same reason the battle side
-- keeps them apart: a vehicle is not a unit. It does not fight, it is not housed, it does not
-- count against the supply cap, and every query that reads a force would have had to learn to
-- filter it out.
--
-- Defaulted to an empty object, so every run already on the road parses as the walk it was.
ALTER TABLE missions ADD COLUMN vehicles_json TEXT NOT NULL DEFAULT '{}';
