-- The tiered refits are gone (maintainer, 2026-09-15): thirty modification cards replace them.
--
-- `fitted_upgrades_json` is the crew's stock of built refits and `unit_loadouts_json` is which of
-- them sit in which unit's three brackets. Both hold refit ids (`armour_2`, `weapons_3`, ...) that
-- no catalogue answers to any more, and a refit has no card it maps onto: a rung on a ladder is
-- not a card in a set. There is nothing honest to convert them into, so both columns are cleared.
--
-- DESTRUCTIVE to dev saves: every crew loses every refit it built and every bracket it filled. The
-- scrap and parts spent on them are not refunded. This ships while the only saves are development
-- ones; a live save would want a refund line here rather than a wipe.
--
-- `db/repos/bases.ts` also drops any id neither catalogue knows on the way out of the database,
-- so a row this did not reach (or a card retired later) still opens.
UPDATE bases
SET fitted_upgrades_json = json('[]'),
    unit_loadouts_json = json('{}');
