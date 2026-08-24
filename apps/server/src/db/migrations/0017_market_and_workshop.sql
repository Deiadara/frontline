-- The market, the workshop and the Garage all need somewhere to keep what they produce.
--
-- Three columns on `bases` and one new table.
--
-- The columns are the crew's own state: what is in the satchel, what the workshop has fitted, and
-- what is parked in the yard. All three are JSON for the same reason every other collection here
-- is: they are read whole, written whole, and validated by a Zod schema on the way out, so a
-- normalised table would buy nothing and cost a join on every read.
--
-- `market_offers` is a table rather than a column because a listing is *shared*: it belongs to the
-- board, not to either crew, and it has to be findable by everybody without loading every base.

ALTER TABLE bases ADD COLUMN inventory_json TEXT;
ALTER TABLE bases ADD COLUMN fitted_upgrades_json TEXT;
ALTER TABLE bases ADD COLUMN fleet_json TEXT;

UPDATE bases SET inventory_json = json('{}') WHERE inventory_json IS NULL;
UPDATE bases SET fitted_upgrades_json = json('[]') WHERE fitted_upgrades_json IS NULL;
UPDATE bases SET fleet_json = json('{}') WHERE fleet_json IS NULL;

CREATE TABLE IF NOT EXISTS market_offers (
  id             TEXT PRIMARY KEY,
  seller_base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  seller_name    TEXT NOT NULL,
  give_json      TEXT NOT NULL,
  want_json      TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  -- Set when this listing is a counter to another. The original is not modified: a counter is a
  -- new offer pointed at one crew, so accepting either settles exactly one trade.
  counter_to     TEXT REFERENCES market_offers(id) ON DELETE CASCADE,
  directed_at    TEXT REFERENCES bases(id) ON DELETE CASCADE
);

-- The board is read by status far more often than by anything else: every visit lists the open
-- ones and ignores the rest.
CREATE INDEX IF NOT EXISTS idx_market_offers_status ON market_offers(status);
CREATE INDEX IF NOT EXISTS idx_market_offers_seller ON market_offers(seller_base_id);
