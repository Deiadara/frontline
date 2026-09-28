-- Goods the trading board is holding for a crew until it presses Claim (maintainer, 2026-09-28).
--
-- A taken listing's payment, an expired listing's goods and a closed counter's goods used to go
-- straight into the stores of a crew that was not on the screen, and whatever did not fit was
-- thrown away without a word. They wait here for 24 hours instead; after that the world clock
-- credits them anyway and the overflow is lost. A row is deleted once its goods are paid out.
--
-- `offer_id` keeps the listing the goods came off, so the claim can say what the trade was.
CREATE TABLE IF NOT EXISTS market_claims (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  offer_id       TEXT NOT NULL REFERENCES market_offers(id) ON DELETE CASCADE,
  reason         TEXT NOT NULL,
  resources_json TEXT NOT NULL,
  items_json     TEXT NOT NULL,
  taken_by       TEXT,
  created_at     TEXT NOT NULL,
  claim_until    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_claims_base ON market_claims(base_id);
-- The world clock asks for the lapsed ones every second.
CREATE INDEX IF NOT EXISTS idx_market_claims_until ON market_claims(claim_until);
