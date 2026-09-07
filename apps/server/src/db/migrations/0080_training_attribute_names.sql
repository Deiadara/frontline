-- 0075 renamed two attributes (hacking to signals, fabrication to craft) and retired demolition in
-- the overseer's sheet and every officer's, and missed the third place an attribute name is
-- stored: `bases.training_json`, where `sessions[].attribute` and `last` (what each person drilled
-- most recently, kept for the no-repeat rule) both name one. A crew that had drilled Signals under
-- its old name failed the schema on every read after 0075, so every authenticated route answered
-- 500 for that account.
--
-- The rename is a plain swap on the quoted value: no id, day or timestamp in this column can
-- contain the quoted word. A retired attribute is handled on read (`rowToBase` drops sessions and
-- `last` entries naming one), the same floor every other salvaged column has, so this migration
-- only has to move the names that still exist.
UPDATE bases
SET training_json = replace(
    replace(training_json, '"hacking"', '"signals"'),
    '"fabrication"', '"craft"'
  )
WHERE training_json IS NOT NULL;
