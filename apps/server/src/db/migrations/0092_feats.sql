-- Feats (maintainer request, 2026-09-13): the two tables an achievement system needs.
--
-- ## Why a counter table at all
--
-- Most of what a feat asks about is already on the crew: its level, its buildings, the officers on
-- its books. Those are read straight off the row and cost nothing. The rest are lifetime questions
-- the game kept no answer to, either because it kept no record (units trained, vehicles built,
-- caps ever earned) or because the record is a history table that would have to be scanned.
--
-- Scanning was the obvious route and is the wrong one. The crew file already pays to read up to
-- two thousand battle rows to print one win/loss line, and a feats screen asks a dozen questions
-- of that shape on every poll. `crew_tallies` is one integer per question per crew, incremented in
-- place, which is the same shape `factions.infamy_earned` has used since 0050 and for the same
-- reason.
--
-- Keyed by base rather than by user because everything a feat counts is something a *crew* did,
-- and the crew is the row every event site already has in its hand.
--
-- ON DELETE CASCADE on both: a deleted crew leaves no orphan counters and no orphan claims.
CREATE TABLE IF NOT EXISTS crew_tallies (
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  -- The snapshot key of a `tally` measure: `units_trained`, or `missions_in_area:rustyard`.
  -- Scoped keys are why this is a row per name rather than a column per name: there is one per
  -- district per crew, and districts are content.
  tally TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (base_id, tally)
) STRICT;

-- What has been collected, and when. One row per feat per crew, written once and never updated:
-- claiming is not reversible, so an UPSERT here is the whole of the double-pay guard.
CREATE TABLE IF NOT EXISTS crew_feats (
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  feat_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (base_id, feat_id)
) STRICT;

-- The feats screen reads every claim for one crew on every open, and the badge count reads it on
-- every poll of `/me`. The primary key already leads with `base_id`, so that pair is covered; this
-- is for the other direction, the one an author asking "who has done this" will want.
CREATE INDEX IF NOT EXISTS idx_crew_feats_feat ON crew_feats(feat_id);
