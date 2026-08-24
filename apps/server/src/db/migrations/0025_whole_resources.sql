-- Stockpiles are whole units now, so every row written before that rule has to be made whole.
--
-- `ResourcesSchema` gained `.int()`, which turns a stored `37772.751872` into a row the next boot
-- cannot parse — the same failure mode as `0024_repair_null_stockpiles.sql`, arriving from the
-- other direction. The fractions came from production accrual, which quoted output per hour and
-- wrote whatever a settle of arbitrary length produced straight into the column. That is fixed at
-- the source: whole units go to the stockpile and the remainder is carried in
-- `economy_json.productionCarry`, so nothing is rounded away and nobody loses a fast poll.
--
-- `CAST(x AS INTEGER)` truncates towards zero, which is a floor for the non-negative amounts these
-- columns hold. Down rather than up, deliberately: a repair must never hand a crew resources it did
-- not earn, and the fraction being dropped is at most one unit of one thing.
--
-- `productionCarry` itself needs no repair — it is defaulted on the schema, so a base written
-- before it existed parses as owing nothing, which is exactly true.

-- The stockpile.
UPDATE bases
SET resources_json = json_set(
    resources_json,
    '$.caps', CAST(json_extract(resources_json, '$.caps') AS INTEGER),
    '$.food', CAST(json_extract(resources_json, '$.food') AS INTEGER),
    '$.oil', CAST(json_extract(resources_json, '$.oil') AS INTEGER),
    '$.scrap', CAST(json_extract(resources_json, '$.scrap') AS INTEGER),
    '$.highQualityMetal', CAST(json_extract(resources_json, '$.highQualityMetal') AS INTEGER)
  )
WHERE CAST(json_extract(resources_json, '$.caps') AS INTEGER) <> json_extract(resources_json, '$.caps')
   OR CAST(json_extract(resources_json, '$.food') AS INTEGER) <> json_extract(resources_json, '$.food')
   OR CAST(json_extract(resources_json, '$.oil') AS INTEGER) <> json_extract(resources_json, '$.oil')
   OR CAST(json_extract(resources_json, '$.scrap') AS INTEGER) <> json_extract(resources_json, '$.scrap')
   OR CAST(json_extract(resources_json, '$.highQualityMetal') AS INTEGER) <> json_extract(resources_json, '$.highQualityMetal');

-- The wage book. Every writer of it already rounds, so this is a belt on a fastened braces: the
-- book is keyed by officer id, so it is rebuilt rather than patched key by key.
UPDATE bases
SET economy_json = json_set(
    economy_json,
    '$.payroll.wages',
    (SELECT json_group_object(key, CAST(value AS INTEGER))
       FROM json_each(bases.economy_json, '$.payroll.wages'))
  )
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.economy_json, '$.payroll.wages')
   WHERE CAST(value AS INTEGER) <> value
);

-- Listings on the board. The one place a *player* could post an arbitrary number: what an offer
-- gives is escrowed out of a stockpile and what it wants is paid into one, so a fractional listing
-- is a fractional stockpile waiting to happen.
UPDATE market_offers
SET give_json = json_set(
    give_json,
    '$.resources',
    (SELECT json_group_object(key, CAST(value AS INTEGER))
       FROM json_each(market_offers.give_json, '$.resources'))
  )
WHERE EXISTS (
  SELECT 1 FROM json_each(market_offers.give_json, '$.resources')
   WHERE CAST(value AS INTEGER) <> value
);

UPDATE market_offers
SET want_json = json_set(
    want_json,
    '$.resources',
    (SELECT json_group_object(key, CAST(value AS INTEGER))
       FROM json_each(market_offers.want_json, '$.resources'))
  )
WHERE EXISTS (
  SELECT 1 FROM json_each(market_offers.want_json, '$.resources')
   WHERE CAST(value AS INTEGER) <> value
);
