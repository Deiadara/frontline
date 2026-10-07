-- The days each crew's held ground has already paid its daily grants on (maintainer, 2026-10-06).
--
-- The Scriptorium's page, the Dispensary's stim, the Chop Shop's components and the Trophy Hall's
-- pay all land once an Athens day, on the first world tick of the day that finds the crew holding
-- the location. One row per crew per day, keyed on the two, and the row is the claim: `city/daily.ts`
-- inserts it before it pays, so a restart, a retried tick or two ticks racing each other pay once.
-- Like `garrison_regrowth`, a table of its own rather than a column on the base, because the
-- question is about a day rather than about any one plot, and a crew that has never been paid is
-- honestly a crew with no rows.
CREATE TABLE daily_grants (
  base_id TEXT NOT NULL,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (base_id, day)
);
