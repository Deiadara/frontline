-- §D7 — what a name buys, one fight at a time.
--
-- The boost a side bought for this battle, or NULL. On the deployment rather than on the battle
-- because both sides get one, and paid for at the moment it is chosen: see `battle/boosts.ts`.
--
-- A plain nullable column with no CHECK against a catalogue: the catalogue is TypeScript, and a
-- boost retired from it must leave old rows readable rather than take a whole read offline.
ALTER TABLE battle_deployments ADD COLUMN boost_id TEXT;
