-- Spying (maintainer, 2026-09-22): a job on the clock, and the report it comes home with.
--
-- `spy_runs` is the scouting table's shape with a target and a price on it. A run has no officer
-- for the reason a scout party has none: the Master of Whispers sends it from the chair. The
-- target is JSON because it is one of two shapes (a location, or a district read at its gate)
-- and the row is only ever read back through `SpyTargetSchema`.
--
-- `spy_reports` is kept for ever. A report is what a crew knows about a place, and the holder,
-- the district and the place are frozen as text: the ground changes hands and the report is
-- about the night it was written. `accuracy_shown` and `unseen` are frozen too, so a rung
-- finished later does not sharpen an old report retroactively.
CREATE TABLE spy_runs (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  target_json    TEXT NOT NULL,
  tier           TEXT NOT NULL,
  caps_paid      INTEGER NOT NULL,
  departed_at    TEXT NOT NULL,
  returns_at     TEXT NOT NULL,
  travel_minutes INTEGER NOT NULL DEFAULT 0,
  settled_at     TEXT,
  recalled_at    TEXT
);
CREATE INDEX spy_runs_due ON spy_runs (settled_at, returns_at);
CREATE INDEX spy_runs_base ON spy_runs (base_id, settled_at);

CREATE TABLE spy_reports (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  target_json    TEXT NOT NULL,
  district_id    TEXT NOT NULL,
  district_name  TEXT NOT NULL,
  place_name     TEXT NOT NULL,
  holder_json    TEXT NOT NULL,
  tier           TEXT NOT NULL,
  caps_paid      INTEGER NOT NULL,
  written_at     TEXT NOT NULL,
  failed         INTEGER NOT NULL DEFAULT 0,
  exposed_json   TEXT NOT NULL,
  accuracy       REAL NOT NULL,
  unseen         INTEGER,
  accuracy_shown INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX spy_reports_base ON spy_reports (base_id, written_at);

-- The two tracks were redone around spying, and six rungs went with the old shape: four of the
-- Master of Whispers' (Cut-Outs, Legend Building, One-Time Pads, The Long Silence) and two of the
-- Consigliere's (Backchannels, Sitting Down). Dropped from every save for the reason 0108 gives:
-- `feats/snapshot.ts` counts `research_done` off the raw array. A project still on the bench
-- for one of them is taken off it; the bench is free and nothing was paid twice, since a
-- finished rung is the only thing the array records.
UPDATE bases
SET research_json = json_set(
  research_json,
  '$.technologies',
  (
    SELECT COALESCE(json_group_array(value), json_array())
    FROM json_each(research_json, '$.technologies')
    WHERE value NOT IN (
      'tech_cut_outs', 'tech_legend_building', 'tech_one_time_pads', 'tech_the_long_silence',
      'tech_backchannels', 'tech_sitting_down'
    )
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.research_json, '$.technologies')
  WHERE value IN (
    'tech_cut_outs', 'tech_legend_building', 'tech_one_time_pads', 'tech_the_long_silence',
    'tech_backchannels', 'tech_sitting_down'
  )
);

UPDATE bases
SET research_json = json_set(research_json, '$.active', json('null'))
WHERE json_extract(research_json, '$.active.id') IN (
  'tech_cut_outs', 'tech_legend_building', 'tech_one_time_pads', 'tech_the_long_silence',
  'tech_backchannels', 'tech_sitting_down'
);
