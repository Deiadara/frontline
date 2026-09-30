-- The District Offers board is a city's, not the world's (maintainer, 2026-09-29).
--
-- Every city tab showed the same listings, so a crew with no ground in Ashfall could read and take
-- an Ashfall crew's offer off its own Terminus board. A listing now belongs to the city it was
-- posted in, and a counter to the city of the listing it answers.
--
-- Rows written before this had no city. An open one is pinned to its poster's home city, which is
-- the board it was most likely posted on and the one the poster can always reach. A closed one is
-- history and only read to say what a claim came from, so the open city's id is as good as any.
-- The district lists are `city/atlas.ts` as it stands today: Ashfall is the default, so only the
-- other two cities a crew can live in are spelled out.
ALTER TABLE market_offers ADD COLUMN city_id TEXT NOT NULL DEFAULT 'ashfall';

UPDATE market_offers
SET city_id = 'terminus'
WHERE status = 'open'
  AND seller_base_id IN (
    SELECT id FROM bases WHERE district_id IN (
      'coldwater-halt', 'ironmouth', 'marshalling-yards', 'bonded-row', 'telemetry-hill',
      'viaduct', 'last-platform', 'blockhouse', 'carriage', 'watertower', 'embankment', 'signalrow'
    )
  );

UPDATE market_offers
SET city_id = 'saltmarch'
WHERE status = 'open'
  AND seller_base_id IN (
    SELECT id FROM bases WHERE district_id IN (
      'tidewalk', 'hulls', 'lockgate', 'quayside', 'fishrow', 'raftfield', 'highwater'
    )
  );

-- A counter goes up on its listing's board, whoever posted it.
UPDATE market_offers
SET city_id = (SELECT parent.city_id FROM market_offers AS parent WHERE parent.id = market_offers.counter_to)
WHERE status = 'open'
  AND counter_to IS NOT NULL
  AND EXISTS (SELECT 1 FROM market_offers AS parent WHERE parent.id = market_offers.counter_to);

CREATE INDEX market_offers_city_status ON market_offers (city_id, status, created_at);
