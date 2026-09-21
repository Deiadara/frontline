-- The Professor's fourth rung is Second Chair now, and the old one leaves no ghost behind.
--
-- "Working Papers" (+7% off every research clock) was replaced by "Second Chair", which adds a
-- bench to the training floor (maintainer, 2026-09-21). A rung's id is derived from its name
-- (`buildTrack` and `idOf` in `research/tracks.ts`, which prefixes `tech_`), so this is not a
-- retune of one row: `tech_working_papers` is an id the catalogue no longer has, and
-- `tech_second_chair` is a new one.
--
-- Nothing throws over it. `ResearchStateSchema.technologies` is `z.array(z.string())` rather than
-- a key schema, and `researchEffects` skips ids the catalogue cannot find, so a save carrying the
-- old id loads and pays nothing for it. Two things are wrong all the same, and both are the quiet
-- kind:
--
-- 1. `feats/snapshot.ts` reads `research_done` as `base.research.technologies.length`, raw. A
--    crew that finished Working Papers is counted one programme ahead of what it has, for ever,
--    against a ladder that goes to a hundred and ninety.
-- 2. The Lab's own progress comes off `trackProgress`, which matches against the catalogue, so
--    the Professor's track would read 6 of 10 while the tally beside it read 7. Two numbers about
--    the same track disagreeing is the report this kind of change earns.
--
-- Deleted rather than renamed to `second_chair`. A crew that paid for seven per cent off a
-- research clock did not pay for a second bench: the rungs cost the same but they are not the
-- same thing, and handing over the bench would be paying out a purchase nobody made. The rung is
-- open again, at its own price, which is what retiring a rung means everywhere else in this
-- schema (`0039_bell_ringers_retired.sql`).
--
-- `json_remove` on an array element needs the index, so the rewrite is done by rebuilding the
-- array from the elements that are not the retired id. A save that never finished it is left
-- byte-identical by the `WHERE`, and running this twice changes nothing.

UPDATE bases
SET research_json = json_set(
  research_json,
  '$.technologies',
  (
    SELECT COALESCE(json_group_array(value), json_array())
    FROM json_each(research_json, '$.technologies')
    WHERE value <> 'tech_working_papers'
  )
)
WHERE EXISTS (
  SELECT 1 FROM json_each(bases.research_json, '$.technologies') WHERE value = 'tech_working_papers'
);
