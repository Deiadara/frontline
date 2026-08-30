-- Officers stopped being a relationship you maintain and became a decision you make.
--
-- Four mechanics came off the sheet at once, because they were one idea between them: an officer
-- had an `ambition` and a `moralCompass` (what they were after), an `alignment` that drifted while
-- you were not looking, and a `level` with banked XP and points to assign. Keeping nineteen people
-- happy and nineteen people levelled was a second game running beside the city, the army and the
-- research tree, and none of it was a decision anybody made on purpose.
--
-- What replaces it is the perk book (`crew/perks.ts`): a hundred-odd discrete bonuses, nought to
-- three per officer, visible at the Bar before a cap is committed and fixed for as long as they
-- are on the books.
--
-- Both stores here hold their characters as JSON blobs, so this is a `json_*` rewrite rather than
-- a column drop. SQLite has shipped the JSON1 functions in the default build since 3.38, and
-- better-sqlite3 is well past that.

-- The Overseer. `traits_json` becomes `perks_json`, and the contents cannot simply carry over:
-- trait ids are not perk ids, so a straight rename would leave every Overseer holding a keyword
-- the catalogue no longer knows and `knownCommanders`-style scrubbing would silently empty it.
-- Each archetype gets the one perk its preset now ships with instead (see `overseer.ts`), matched
-- on `preset_id`, which is exactly the information needed and is already on the row.
ALTER TABLE overseers RENAME COLUMN traits_json TO perks_json;

UPDATE overseers
SET perks_json = CASE preset_id
    WHEN 'enforcer' THEN '["reputation"]'
    WHEN 'netrunner' THEN '["wire_tap"]'
    WHEN 'fixer' THEN '["haggler"]'
    WHEN 'technocrat' THEN '["sorted_heap"]'
    ELSE '[]'
  END;
