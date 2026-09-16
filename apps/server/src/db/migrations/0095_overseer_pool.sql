-- The Overseer pool: one account per character, going forward (maintainer, 2026-09-15).
--
-- A player is offered four characters out of thirty and the one they take leaves the pool for
-- everybody. `POST /overseer` re-reads the claimed set inside its transaction, but a rule that
-- lives only in a read-then-write is a rule with nothing durable underneath it: migration 0074 put
-- a unique index behind "one Overseer per account" for exactly this reason, and this is the same
-- rule on the other axis.
--
-- ## Why the rewrite below has to happen first
--
-- The index cannot simply be created. Every save that predates the pool was played against four
-- presets with no exclusivity at all, so on any database with more than a handful of accounts
-- duplicate `preset_id` values are close to certain, `CREATE UNIQUE INDEX` fails, the migration
-- refuses to apply and the server does not boot. The first cut of this migration banked on the
-- three distinct values a fresh development database happens to hold, which is true of exactly one
-- machine.
--
-- So the duplicates are resolved before the index is built, and the rule for resolving them is the
-- only one that costs nobody their character: **the earliest claim keeps it.** A later holder of
-- the same preset keeps their Overseer exactly as it is (the name, the face, the sheet and the
-- perks are their own columns, and none of them is touched) and simply stops holding the *claim*,
-- which they have no further use for: an account claims a character once, at creation, and never
-- reads `preset_id` again. The suffixed value cannot collide with a real preset id, so it reads as
-- what it is, a spent claim, and `claimedPresetIds` correctly reports the preset as held by the
-- one account that got there first.
UPDATE overseers
SET preset_id = preset_id || ':' || id
WHERE id NOT IN (
  SELECT id FROM overseers AS keep
  WHERE keep.created_at = (
    SELECT MIN(earliest.created_at) FROM overseers AS earliest
    WHERE earliest.preset_id = keep.preset_id
  )
  GROUP BY keep.preset_id
);

CREATE UNIQUE INDEX idx_overseers_preset ON overseers (preset_id);
