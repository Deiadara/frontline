-- The attribute model (MOU-160, GDD §B, §C).
--
-- Characters move off the 1..20 eight-skill sheet onto 0..100 attributes plus traits, and
-- officer roles become the 19 positions in §C1. Every persisted character therefore holds a
-- sheet that no longer validates: old `skills_json` is on the wrong scale, and the bot base's
-- `commanders_json` names roles that no longer exist.
--
-- There is no live player data (GDD §D9 establishes that a destructive migration is acceptable),
-- so the stale characters are dropped rather than translated across a scale that is gone.
-- The seeder rebuilds the AI rival on next boot; players re-run character select.

UPDATE users SET overseer_id = NULL;

DELETE FROM battles;
DELETE FROM bases;
DELETE FROM overseers;

ALTER TABLE overseers RENAME COLUMN skills_json TO attributes_json;
ALTER TABLE overseers ADD COLUMN traits_json TEXT NOT NULL DEFAULT '[]';
