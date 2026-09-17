-- The shelf is gone: a modification is cut for a named structure or unit and bolted straight in.
--
-- Until now the yard cut a card onto a shelf (`bases.addons_json -> built` for structures,
-- `bases.fitted_upgrades_json` for units) and a second screen moved it into a bracket. That left a
-- state in between where a crew owned a thing that did nothing, and it meant two screens, two
-- refusal tables and two chances for them to disagree. Building and fitting are one press as of
-- 2026-09-16, so there is no longer anywhere for an unfitted card to live.
--
-- The maintainer's ruling on what happens to the cards already sitting on those shelves: drop them.
-- Not refunded, because the same ruling says a dismantled card pays nothing back either, and a
-- shelf that paid out on the way through would be the one place in the mechanic that did.
--
-- What is *fitted* is untouched. Structure brackets live in `bases.district_json -> buildings[] ->
-- modifications`, and unit brackets in `bases.unit_loadouts_json`; neither is read here. A crew
-- keeps every card it had actually bolted to something.
UPDATE bases
   SET addons_json = json_set(
         COALESCE(addons_json, '{"researched":[],"built":[]}'),
         '$.built',
         json('[]')
       )
 WHERE addons_json IS NOT NULL
   AND json_extract(addons_json, '$.built') IS NOT NULL
   AND json_array_length(json_extract(addons_json, '$.built')) > 0;

UPDATE bases
   SET fitted_upgrades_json = json('[]')
 WHERE fitted_upgrades_json IS NOT NULL
   AND json_array_length(fitted_upgrades_json) > 0;
