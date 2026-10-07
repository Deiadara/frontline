-- A Stackhouse bet records what was charged (maintainer, 2026-10-06).
--
-- Admin mode charges nothing for a bet, and the row kept the typed stake, so a refund or a win paid
-- out real caps on a bet that cost none. The stake on record is now the charge, which is zero for
-- an admin bet, and `CHECK (stake > 0)` refused that row. SQLite cannot change a CHECK in place, so
-- the table is rebuilt with `stake >= 0` and everything else as 0145 wrote it.
CREATE TABLE stackhouse_bets_new (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases (id),
  battle_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
  stake INTEGER NOT NULL CHECK (stake >= 0),
  place TEXT NOT NULL,
  backing TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  placed_at TEXT NOT NULL,
  settled_at TEXT,
  outcome TEXT CHECK (outcome IN ('won', 'lost', 'refunded')),
  payout INTEGER NOT NULL DEFAULT 0
);

INSERT INTO stackhouse_bets_new
  (id, base_id, battle_id, side, stake, place, backing, starts_at, placed_at, settled_at, outcome,
   payout)
SELECT id, base_id, battle_id, side, stake, place, backing, starts_at, placed_at, settled_at,
       outcome, payout
  FROM stackhouse_bets;

DROP TABLE stackhouse_bets;
ALTER TABLE stackhouse_bets_new RENAME TO stackhouse_bets;

CREATE UNIQUE INDEX idx_stackhouse_one_riding ON stackhouse_bets (base_id) WHERE settled_at IS NULL;
CREATE INDEX idx_stackhouse_unsettled ON stackhouse_bets (settled_at);
