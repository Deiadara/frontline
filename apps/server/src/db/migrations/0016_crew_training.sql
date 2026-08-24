-- The Overseer and the officers can drill now (GDD §F2), and a district needs somewhere to keep
-- the day's tally, whatever is in flight, and what each person did last.
--
-- Nullable with no default, and filled in the same statement rather than left to `DEFAULT '{}'`:
-- the shape has to parse as a `TrainingState`, and a column default is a string nobody validates.
-- Every existing district is opened on the day this runs with its full allowance and nothing on
-- the board, which is the only starting state that does not hand out or withhold a session.

ALTER TABLE bases ADD COLUMN training_json TEXT;

UPDATE bases
SET training_json = json_object(
    'day', strftime('%Y-%m-%d', 'now'),
    'used', 0,
    'sessions', json('[]'),
    'last', json('{}')
  )
WHERE training_json IS NULL;
