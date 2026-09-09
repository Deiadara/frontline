-- The Flatbed and the War Hauler left the Garage, and a stored fleet that still names one cannot
-- be read at all.
--
-- `VehicleIdSchema` is a key schema over the live catalogue, so `FleetSchema` rejects a retired id
-- on the way *out of the database* rather than dropping a field: a base that owned a War Hauler
-- fails `BaseSchema.parse` on every read, and a mission or a deployment that took one throws
-- inside the settler, which is the world tick down for everybody rather than one broken account.
-- The three columns below are every place a fleet is persisted (`bases.fleet_json` from 0017,
-- `battle_deployments.vehicles_json` from 0070, `missions.vehicles_json` from 0071).
--
-- The readers repair the same rows on their own (`withoutRetiredVehicles`), so this is the tidy
-- path rather than the only defence: a backup restored from before today still opens. Nobody is
-- refunded what a machine cost. It does not exist to give back, and the crew had the use of it.
--
-- `fleet_json` is nullable and the other two are not, so only that one needs the guard; every
-- statement is filtered on `json_type(...) = 'object'` anyway, which skips a NULL and a row
-- holding anything that is not a JSON object rather than rewriting it into one. `json_remove` is
-- a no-op on a key that is not there, so running this against a swept save touches nothing.

UPDATE bases
SET fleet_json = json_remove(fleet_json, '$.flatbed', '$.war_hauler')
WHERE json_type(fleet_json) = 'object';

UPDATE battle_deployments
SET vehicles_json = json_remove(vehicles_json, '$.flatbed', '$.war_hauler')
WHERE json_type(vehicles_json) = 'object';

UPDATE missions
SET vehicles_json = json_remove(vehicles_json, '$.flatbed', '$.war_hauler')
WHERE json_type(vehicles_json) = 'object';
