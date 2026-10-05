-- The Stackhouse (maintainer, 2026-10-05): bets on declared fights, private to the crew.
--
-- One row per bet. A crew has at most one unsettled bet (`settled_at IS NULL`), which the service
-- enforces and the partial unique index makes a fact of the table. `outcome` and `payout` are
-- written once, when the fight lands or is abandoned.
CREATE TABLE stackhouse_bets (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases (id),
  battle_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
  stake INTEGER NOT NULL CHECK (stake > 0),
  place TEXT NOT NULL,
  backing TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  placed_at TEXT NOT NULL,
  settled_at TEXT,
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'refunded')),
  payout INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_stackhouse_one_riding ON stackhouse_bets (base_id) WHERE settled_at IS NULL;
CREATE INDEX idx_stackhouse_unsettled ON stackhouse_bets (settled_at);
