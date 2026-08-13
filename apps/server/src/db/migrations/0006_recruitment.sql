-- Recruitment — the Bar (MOU-164, GDD §H).
--
-- Number allocated by the CTO under INTERFACES.md R6/R9 — do not renumber, the runner keys
-- `schema_migrations` on the file name and a rename re-applies the migration.
--
-- Per R6/R9 this file stands alone: it touches only `bases.commanders_json`, a column that has
-- existed since `0003_attribute_model.sql`, and reads nothing `0004_missions.sql` or
-- `0005_progression.sql` added.
--
-- There is deliberately **no roster table**. §H2/§H2a make the Bar's daily roster a pure function
-- of the UTC date — one global roster, no per-player rolls — so it is recomputed on every request
-- and never stored (`apps/server/src/bar/roster.ts`). What a player *changes* is stored, and all
-- of it already has a home: held officers are `bases.commanders_json`, and the agreed weekly wage
-- goes into W2's `PayrollState.wages` inside `bases.economy_json` (R9: no second wage column).
--
-- So the one thing left to do is this backfill. §H4 gives every character an ambition and a moral
-- compass, §H5 an alignment meter and §H6 their own level — four fields `CommanderSchema` now
-- requires and no stored officer has. Unlike `0005_progression.sql` there is no ADD COLUMN to
-- carry a DEFAULT here: these live *inside* a JSON array, so the values have to be patched into
-- each element or every existing base fails `BaseSchema.parse` on its next read.
--
-- The literals below are a snapshot of `createCommander`'s defaults as of this migration, on
-- purpose: a migration has to keep describing the past even after that factory moves on. The
-- alignment anchor is the epoch rather than a `now`, which is the honest reading — a pre-§H5
-- officer has no recorded history of agreeing or disagreeing with anything, and `settleAlignment`
-- will move them to whatever they actually think of the crew on the very next read.
--
-- `json_patch` merges rather than replaces, so an officer that somehow already carries these keys
-- keeps its own values, and `json_group_array(json(...))` re-nests the patched objects as JSON
-- instead of escaping them back into strings.

UPDATE bases
SET commanders_json = (
  SELECT json_group_array(
    json(
      json_patch(
        json('{"ambition":"wealth","moralCompass":"pragmatist",'
          || '"alignment":50,"alignmentUpdatedAt":"1970-01-01T00:00:00.000Z",'
          || '"level":1,"xpIntoLevel":0,"unspentPoints":0}'),
        value
      )
    )
  )
  FROM json_each(bases.commanders_json)
)
WHERE json_array_length(commanders_json) > 0;
