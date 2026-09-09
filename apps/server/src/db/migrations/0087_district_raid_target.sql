-- One raid on a district, instead of thirteen fights on thirteen roofs (GDD §A4, board 2026-09-09).
--
-- A `building` target was a call on one structure behind a broken gate. A crew who wanted a home
-- properly turned over had to declare against each roof in turn, which is thirteen declarations
-- against a cap of three, so in practice nobody wrecked anything. The target kind is `district`
-- now: one call, a share of the stockpile and three structures left limping.
--
-- Every row is rewritten, resolved history included, rather than leaving old rows alone and adding
-- a lenient branch to the repo. `resolvedFor` reads finished fights back through the same
-- `ScheduledBattleSchema` a pending one goes through, so a stored `building` row that stayed put
-- would have meant carrying a retired fourth kind in the shared schema for as long as anybody's
-- battle board remembered it. A rewritten row still names the district the fight was over, which is
-- all the board prints.
--
-- sqlite cannot alter a CHECK, so the table has to be rebuilt, and `building_id` goes with it:
-- nothing reads it any more.
--
-- **The rebuild is not the usual new-copy-drop-rename dance, and it cannot be.** Two tables point
-- at this one now, `troop_movements` (0031) and `battle_deployments` (0045). With
-- `foreign_keys = ON` a DROP does an implicit DELETE that orphans their rows, and neither escape
-- hatch is available here: `PRAGMA foreign_keys = OFF` is a no-op inside a transaction and
-- `runMigrations` wraps every file in one (0045 wrote that pragma and it did nothing), while
-- `defer_foreign_keys` only postpones the check to the commit, where renaming a *different* table
-- into place does not clear the violations the drop recorded. Measured, not assumed: both fail.
--
-- What does work is putting the parent rows back into a table of the same name inside the same
-- transaction, which is what decrements the deferred counter. So the rows go to a temp table, the
-- old table is dropped, the new one is created **under the original name**, and the rows come back.
-- The children's `REFERENCES scheduled_battles` resolves to the new table with the same ids in it,
-- and the deferred check at the commit finds nothing orphaned. `migrations.test.ts` runs this with
-- a row in each child table, because without one the migration passes either way.

PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE scheduled_battles_carry AS SELECT * FROM scheduled_battles;

DROP TABLE scheduled_battles;

CREATE TABLE scheduled_battles (
  id TEXT PRIMARY KEY,
  attacker_base_id TEXT NOT NULL REFERENCES bases (id),
  -- 'location' | 'gate' | 'district'
  target_kind TEXT NOT NULL CHECK (target_kind IN ('location', 'gate', 'district')),
  district_id TEXT NOT NULL,
  -- Set only for a 'location' target, and only then.
  location_id TEXT,
  defender_json TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  resolved_at TEXT,
  seed TEXT NOT NULL,
  analysis_json TEXT,
  hold_after_capture INTEGER NOT NULL DEFAULT 0,
  CHECK ((target_kind = 'location') = (location_id IS NOT NULL))
);

INSERT INTO scheduled_battles
  (id, attacker_base_id, target_kind, district_id, location_id,
   defender_json, scheduled_for, declared_at, resolved_at, seed, analysis_json, hold_after_capture)
SELECT
  id, attacker_base_id,
  CASE target_kind WHEN 'building' THEN 'district' ELSE target_kind END,
  district_id, location_id,
  defender_json, scheduled_for, declared_at, resolved_at, seed, analysis_json, hold_after_capture
FROM scheduled_battles_carry;

DROP TABLE scheduled_battles_carry;

CREATE INDEX idx_scheduled_battles_due ON scheduled_battles (resolved_at, scheduled_for);
CREATE INDEX idx_scheduled_battles_attacker ON scheduled_battles (attacker_base_id);
CREATE INDEX idx_scheduled_battles_district ON scheduled_battles (district_id);
