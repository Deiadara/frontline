-- Scouting is a journey somebody makes, not a button (board rework).
--
-- One row per crew that has somebody out. `officer_id` is not a foreign key because officers live
-- in `bases.commanders_json` rather than in a table of their own; the settle checks they are still
-- on the books, and a run whose officer was let go mid-journey simply comes home to nobody.
CREATE TABLE scouting_runs (
  id           TEXT PRIMARY KEY,
  base_id      TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  district_id  TEXT NOT NULL,
  officer_id   TEXT NOT NULL,
  departed_at  TEXT NOT NULL,
  returns_at   TEXT NOT NULL,
  settled_at   TEXT
);

-- The world clock's query: everything due and not yet settled, every second.
CREATE INDEX scouting_runs_due ON scouting_runs (settled_at, returns_at);
-- And the per-crew read, which is what the city screen asks for.
CREATE INDEX scouting_runs_base ON scouting_runs (base_id, settled_at);
