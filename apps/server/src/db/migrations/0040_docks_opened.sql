-- The Docks stopped being somewhere to live and became somewhere to take.
--
-- `neon-docks` was `STARTER_DISTRICT_ID` and a residential district: no locations, not capturable,
-- and every crew created before this migration was settled there. It is contested ground now, with
-- seven holds on it, which leaves those crews living in a district that can be taken off them.
-- That is not a state the game has a rule for: `isDistrictRaidable` reads `kind`, the district
-- screen offers locations where a base should be, and a crew could in principle lose its own home.
--
-- So they move. `ashen-terraces` is a plot of the same kind they were on, it is not the seeded
-- rival's ground (`BOT_DISTRICT_ID` moved to `upper-roofs` in the same change), and a residential
-- district holds one crew, so the sweep is only safe because nobody else was living there.
--
-- Bots are moved too. A bot left in the Docks would be a rival occupying a district the player is
-- now expected to capture, and the capture path has no idea what to do with a base standing on it.
UPDATE bases SET district_id = 'ashen-terraces' WHERE district_id = 'neon-docks';

-- Anything the Docks are holding on behalf of their old residents goes with them. A control row
-- keyed to a location in a district nobody could take is a row that was never reachable; the seven
-- holds are minted fresh by `startingControl` on the next read of the district.
DELETE FROM location_control WHERE location_id LIKE 'neon-docks-%';
