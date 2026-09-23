-- The two weighted mixed orders become one alternating order (maintainer, 2026-09-23).
--
-- `one_mission_two_battles` and `two_missions_one_battle` are no longer values the shared schema
-- accepts, and a row carrying one would fail to parse the moment the world clock read it, which
-- would take the whole tick down rather than one slot. `step` goes back to the top because the
-- sequence it counted through is a different length now.
UPDATE automations
   SET order_kind = 'mixed', step = 0
 WHERE order_kind IN ('one_mission_two_battles', 'two_missions_one_battle');
