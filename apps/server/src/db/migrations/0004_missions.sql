-- Missions, travel and timers (MOU-162, GDD §E).
--
-- Number allocated by the CTO under INTERFACES.md R6/R8 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- R8 also requires this file to stand alone: `0005_progression.sql` lands independently and the
-- two apply in name order, so nothing below reads a column `0005` adds. This migration only
-- creates a new table and touches no existing one.
--
-- A mission freezes the clock it was launched under (`travel_minutes`, `duration_minutes`) and
-- the chance it was launched at (`success_chance`) rather than re-reading the board at
-- resolution: retuning a template must not retime or re-price a run already in flight.
--
-- `seed` is the reason the timer is authoritative. The outcome is rolled from it, so resolving a
-- mission is a pure function of this row — the answer is the same whether the owner is watching
-- the countdown or opens the game a week later. It is server-only and never leaves the process;
-- if it were derivable from `id`, a client could read its own future.

CREATE TABLE missions (
  id               TEXT    PRIMARY KEY,
  base_id          TEXT    NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  template_id      TEXT    NOT NULL,
  started_at       TEXT    NOT NULL,
  travel_minutes   INTEGER NOT NULL,
  duration_minutes INTEGER NOT NULL,
  success_chance   REAL    NOT NULL,
  seed             INTEGER NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('active', 'resolved')),
  outcome          TEXT    CHECK (outcome IN ('success', 'failure')),
  rewards_json     TEXT    NOT NULL DEFAULT '{}',
  resolved_at      TEXT
);

-- Both live queries are "this base's missions": the §E3 timers page reads them all, the resolver
-- reads the active ones.
CREATE INDEX missions_base_id_status ON missions (base_id, status);
