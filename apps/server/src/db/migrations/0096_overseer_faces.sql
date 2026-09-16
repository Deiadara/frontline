-- Move the four original characters onto the new, unshared overseer art (maintainer, 2026-09-15).
--
-- The thirty faces the pool now draws from are `portrait-overseer-01` .. `-30`, and none of them
-- is any officer's. The four the game shipped with are not: `portrait-overseer-2`, `-3` and `-4`
-- are byte-identical to `officer-54`, `officer-47` and `officer-48`, which are still in the pool a
-- crew hires from. So a player carrying one of the original characters could walk into the Bar and
-- be offered an officer wearing their own face, which reads as a rendering fault rather than as a
-- coincidence.
--
-- The four presets kept their ids (`enforcer`, `netrunner`, `fixer`, `technocrat`) and now point at
-- `overseer-01` .. `overseer-04` in preset order, so the rewrite below is the same person with the
-- same name on a face nobody else has. `overseer-1` -> `overseer-01` is a zero pad and nothing
-- more: `substr('overseer-1', 10)` is the digit.
--
-- Scoped to exactly the four legacy ids. A row already on a padded id is left alone, so this is
-- safe to run against a database that has never seen the old art.
UPDATE overseers
SET portrait_id = 'overseer-0' || substr(portrait_id, 10)
WHERE portrait_id IN ('overseer-1', 'overseer-2', 'overseer-3', 'overseer-4');
