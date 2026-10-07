-- Reliquary's state on the ground (maintainer, 2026-10-07): the Tolling Tower's switch, the
-- Pamphlet Wall's pins and the Trophy Hall's tally live on the control row, because each belongs
-- to whoever holds the location and is cleared when it changes hands. One JSON column rather than
-- seven: the row is read whole by every settle, and a shape is easier to grow than a column list.
-- Null is "nothing set", which `groundStateOf` reads as every default.
ALTER TABLE location_control ADD COLUMN ground_json TEXT;
