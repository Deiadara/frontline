-- §D: officers go to the fight.
--
-- Two columns, both nullable, both meaning "nobody".
--
-- `battle_deployments.officer_id` is the one officer a crew is sending to lead this fight. It sits
-- beside `boost_id` for the same reason that one does: both sides get one, both are chosen and
-- changed freely right up to the mark, and an ally reinforcing somebody else's battle has their own
-- row and their own answer. Deliberately **not** a foreign key: officers live inside
-- `bases.commanders_json` rather than in a table of their own, and the settler re-reads the roster
-- at the mark rather than trusting an id written sixteen hours earlier.
ALTER TABLE battle_deployments ADD COLUMN officer_id TEXT;

-- §D4: an officer who would have died comes home injured instead, and is out for a day.
--
-- The timestamp itself lives on the officer inside `bases.commanders_json`, so there is nothing to
-- alter for it: `CommanderSchema.injuredUntil` defaults to null and every officer written before
-- today parses as fit. This index is the other half of the same change. `missions.officer_id` is
-- read on every launch to refuse a crew that is trying to send somebody who is still in a bed, and
-- that lookup had no index behind it.
CREATE INDEX IF NOT EXISTS idx_missions_officer ON missions (officer_id);

-- §C3: the machines a crew is taking to this fight.
--
-- On the deployment beside the units, and for the same reason: what is committed has left the
-- Garage. A fleet that stayed a fact about the base could be promised to three battles at once and
-- the settler would have to invent which one it turned up at. Empty JSON for every row written
-- before the yard could send anything, which is what those rows meant.
ALTER TABLE battle_deployments ADD COLUMN vehicles_json TEXT NOT NULL DEFAULT '{}';
