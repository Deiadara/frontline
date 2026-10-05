-- Making units is mustering now (maintainer, 2026-10-04): "Rename Train (for units) to Muster and
-- mustering, so that training only means improving the attributes". The code says muster, so the
-- names a save stores for it move with it. Six places hold one:
--
-- 1. `bases.training_queue_json`, the unit bench. Renamed to `muster_queue_json`; the officers'
--    `training_json` is the Training tab's board and keeps its name.
-- 2. `notifications.kind`. `NotificationKindSchema` no longer has `unit_trained`, so an old receipt
--    would not parse. It becomes `unit_mustered`.
-- 3. `notification_settings.muted_json`, which lists muted kinds by the same ids.
-- 4. `crew_tallies.tally`, the lifetime count behind the ladder (`units_trained`).
-- 5. `crew_feats.feat_id`, the ladder's claimed rungs (`trained_1` to `trained_10`). A claim left
--    on the old id would read as unclaimed and could be paid twice.
-- 6. The Training Officer perk is the Muster Master (`training_officer` to `muster_master`), held
--    in `overseers.perks_json` and in each officer's `perks` inside `bases.commanders_json`. The
--    readers drop a perk id they do not know, so an unmigrated one would vanish silently.
--
-- The column rename runs once, as every migration does (`schema_migrations`). Every `UPDATE`
-- after it filters on the old value, so a save with none of them is left byte-identical.
ALTER TABLE bases RENAME COLUMN training_queue_json TO muster_queue_json;

UPDATE notifications SET kind = 'unit_mustered' WHERE kind = 'unit_trained';

UPDATE notification_settings
SET muted_json = replace(muted_json, '"unit_trained"', '"unit_mustered"')
WHERE muted_json LIKE '%"unit_trained"%';

UPDATE crew_tallies SET tally = 'units_mustered' WHERE tally = 'units_trained';

UPDATE crew_feats
SET feat_id = 'mustered_' || substr(feat_id, length('trained_') + 1)
WHERE feat_id GLOB 'trained_[0-9]*';

UPDATE overseers
SET perks_json = replace(perks_json, '"training_officer"', '"muster_master"')
WHERE perks_json LIKE '%"training_officer"%';

UPDATE bases
SET commanders_json = replace(commanders_json, '"training_officer"', '"muster_master"')
WHERE commanders_json LIKE '%"training_officer"%';
