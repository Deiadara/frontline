-- More than one name on a fight (maintainer request, 2026-09-12).
--
-- A boost was one column holding one id, because a crew got exactly one. A late rung of the Field
-- Commander's track buys a second, so the column becomes a list. Copied rather than dropped: a
-- fight already called keeps the name it was given, and a row that had none becomes an empty list
-- rather than a list holding a null.
ALTER TABLE battle_deployments ADD COLUMN boost_ids_json TEXT NOT NULL DEFAULT '[]';
UPDATE battle_deployments
   SET boost_ids_json = json_array(boost_id)
 WHERE boost_id IS NOT NULL;
