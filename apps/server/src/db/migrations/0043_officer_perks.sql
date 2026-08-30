-- The officers, inside `bases.commanders_json`, moved onto the perk book.
--
-- Split from 0042 because the two halves are different kinds of thing. 0042 renames a *column*,
-- which is DDL and can only ever run once; this one rewrites JSON, which is a data migration and
-- is written to be safe to apply to a row that has already been through it. Keeping them in one
-- file meant a replay of the data half dragged an un-replayable `ALTER TABLE` along with it.
--
-- See `commander.ts` for why the four mechanics came off the sheet together.
-- `weeklyWage` is carried over from `askingWage` rather than defaulted, and that is the one line
-- here that matters to a live save: the field was renamed because its meaning changed (the opening
-- price had no reader left once the drift was gone), but the *number* is the fee the payroll book
-- has been charging all along. Defaulting it to zero instead would hand every existing crew a
-- roster that works for nothing.
--
-- The perks start empty. There is no honest mapping from a trait to a perk: a trait nudged two of
-- the carrier's own attributes and a perk moves the whole crew's economy, so inventing one would
-- be handing out bonuses nobody was offered. Officers already on the books keep their sheet, which
-- is what they were hired for, and the perk book starts paying out at the next hire.
UPDATE bases
SET commanders_json = (
  SELECT json_group_array(
    json_object(
      'id', json_extract(officer.value, '$.id'),
      'name', json_extract(officer.value, '$.name'),
      'role', json_extract(officer.value, '$.role'),
      'attributes', json_extract(officer.value, '$.attributes'),
      -- `COALESCE` on both, so this is idempotent and safe on a row that has already been through
      -- it: re-running must not wipe the perks an officer has since been hired with, and must not
      -- reset a fee back to the opening price. A migration that is only correct the first time is
      -- one restore away from being wrong.
      'perks', COALESCE(json_extract(officer.value, '$.perks'), json('[]')),
      'weeklyWage', COALESCE(
        json_extract(officer.value, '$.weeklyWage'),
        json_extract(officer.value, '$.askingWage'),
        0
      )
    )
  )
  FROM json_each(bases.commanders_json) AS officer
)
WHERE json_valid(commanders_json) AND json_array_length(commanders_json) > 0;
