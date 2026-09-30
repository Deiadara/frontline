-- Three feat counters that were paid for things that did not happen (audit, 2026-09-28).
--
-- ## A unit move remembers whether it rode
--
-- `rail_journeys` was counted when the ride was chosen, so a column put on the train and turned
-- round in its first tenth banked a journey it never made. It is counted at the landing now, and
-- the landing needs to know which moves were on the line. `troop_movements` got the same column in
-- 0122; this is the other half of the railway. Zero for every move already on the road.
ALTER TABLE unit_moves ADD COLUMN by_rail INTEGER NOT NULL DEFAULT 0;

-- ## One trading deal per counterparty per market day
--
-- `market_buys` and `market_sales` counted every deal, so ten scrap at the Broker thirty times, or
-- two accounts passing one scrap back and forth, climbed both ladders for nothing. A deal now counts
-- once a day per counterparty (`feats/tally.ts`), and this is the record of which ones already did.
-- Only the current day is ever read, so the tally prunes a crew's older rows as it writes.
CREATE TABLE IF NOT EXISTS crew_market_deals (
  base_id      TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  tally        TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  day          TEXT NOT NULL,
  PRIMARY KEY (base_id, tally, counterparty, day)
);

-- ## A broken gate is a breach, not a capture
--
-- A won gate fight breaks the gate for a day (`GATE_BREACH_HOURS`) and nobody holds it afterwards,
-- so the measure is renamed to what it counts. Every crew keeps the gates it has already broken.
UPDATE crew_tallies SET tally = 'gates_breached' WHERE tally = 'gates_captured';
