-- The ids are the names the tags show (maintainer, 2026-09-25).
--
-- `/game/city/blacksite-7` became `/game/city/blacksite`, and every other district whose id was an
-- authoring note rather than its name moved with it: the Steelbelt was `rustyard`, the Annexes were
-- `datavault-sigma`, the CCS was `combine-spire`, and every district in Terminus and Saltmarch
-- carried a two-letter city prefix that said nothing a player ever sees. A location keeps its
-- district's id as its prefix, so `rustyard-press` is `steelbelt-press` now.
--
-- The catalogue is code and moved with the rename; this is the half that is data. A save written
-- before it holds ground under ids the atlas no longer has, and every one of those rows reads as a
-- district that does not exist: a crew standing nowhere, a fight over ground with no name, a
-- control row nothing can match. The columns below are every place an id is stored.
--
-- District columns are rewritten by equality and location columns by prefix, which is the same
-- rename applied twice: `replace(location_id, 'rustyard-', 'steelbelt-')` moves the whole district's
-- locations in one statement and cannot touch another district's, because no old id is a prefix of
-- another old id. The two JSON columns carry a place as `{"kind":"district","districtId":"..."}` or
-- the location form, so they are rewritten on `"<old>` with the opening quote included: that anchors
-- the match to the start of a value and catches both shapes.

-- Districts, by equality.
UPDATE bases SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

-- The rest of the district columns, the same way.

UPDATE admin_fog SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE battles SET target_district_id = CASE target_district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE target_district_id END;

UPDATE captured_gates SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE district_gates SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE district_intel SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE scheduled_battles SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE scouting_runs SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE spy_reports SET district_id = CASE district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE district_id END;

UPDATE troop_movements SET from_district_id = CASE from_district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE from_district_id END;

UPDATE troop_movements SET to_district_id = CASE to_district_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE to_district_id END;

UPDATE missions SET area_id = CASE area_id
  WHEN 'rustyard' THEN 'steelbelt'
  WHEN 'datavault-sigma' THEN 'annexes'
  WHEN 'blacksite-7' THEN 'blacksite'
  WHEN 'combine-spire' THEN 'ccs'
  WHEN 'tm-coldwater' THEN 'coldwater-halt'
  WHEN 'tm-ironmouth' THEN 'ironmouth'
  WHEN 'tm-marshalling' THEN 'marshalling-yards'
  WHEN 'tm-bonded' THEN 'bonded-row'
  WHEN 'tm-telemetry' THEN 'telemetry-hill'
  WHEN 'tm-viaduct' THEN 'viaduct'
  WHEN 'tm-terminus' THEN 'last-platform'
  WHEN 'tm-blockhouse' THEN 'blockhouse'
  WHEN 'tm-carriage' THEN 'carriage'
  WHEN 'tm-watertower' THEN 'watertower'
  WHEN 'tm-embankment' THEN 'embankment'
  WHEN 'tm-signalrow' THEN 'signalrow'
  WHEN 'sm-tidewalk' THEN 'tidewalk'
  WHEN 'sm-hulls' THEN 'hulls'
  WHEN 'sm-lockgate' THEN 'lockgate'
  WHEN 'sm-quayside' THEN 'quayside'
  WHEN 'sm-fishrow' THEN 'fishrow'
  WHEN 'sm-raftfield' THEN 'raftfield'
  WHEN 'sm-highwater' THEN 'highwater'
  ELSE area_id END;

-- Locations, by their district prefix. A location id is its district id and a suffix.

UPDATE allied_garrisons SET location_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(location_id, 'rustyard-', 'steelbelt-'), 'datavault-sigma-', 'annexes-'), 'blacksite-7-', 'blacksite-'), 'combine-spire-', 'ccs-'), 'tm-coldwater-', 'coldwater-halt-'), 'tm-ironmouth-', 'ironmouth-'), 'tm-marshalling-', 'marshalling-yards-'), 'tm-bonded-', 'bonded-row-'), 'tm-telemetry-', 'telemetry-hill-'), 'tm-viaduct-', 'viaduct-'), 'tm-terminus-', 'last-platform-'), 'tm-blockhouse-', 'blockhouse-'), 'tm-carriage-', 'carriage-'), 'tm-watertower-', 'watertower-'), 'tm-embankment-', 'embankment-'), 'tm-signalrow-', 'signalrow-'), 'sm-tidewalk-', 'tidewalk-'), 'sm-hulls-', 'hulls-'), 'sm-lockgate-', 'lockgate-'), 'sm-quayside-', 'quayside-'), 'sm-fishrow-', 'fishrow-'), 'sm-raftfield-', 'raftfield-'), 'sm-highwater-', 'highwater-');

UPDATE battles SET target_place_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(target_place_id, 'rustyard-', 'steelbelt-'), 'datavault-sigma-', 'annexes-'), 'blacksite-7-', 'blacksite-'), 'combine-spire-', 'ccs-'), 'tm-coldwater-', 'coldwater-halt-'), 'tm-ironmouth-', 'ironmouth-'), 'tm-marshalling-', 'marshalling-yards-'), 'tm-bonded-', 'bonded-row-'), 'tm-telemetry-', 'telemetry-hill-'), 'tm-viaduct-', 'viaduct-'), 'tm-terminus-', 'last-platform-'), 'tm-blockhouse-', 'blockhouse-'), 'tm-carriage-', 'carriage-'), 'tm-watertower-', 'watertower-'), 'tm-embankment-', 'embankment-'), 'tm-signalrow-', 'signalrow-'), 'sm-tidewalk-', 'tidewalk-'), 'sm-hulls-', 'hulls-'), 'sm-lockgate-', 'lockgate-'), 'sm-quayside-', 'quayside-'), 'sm-fishrow-', 'fishrow-'), 'sm-raftfield-', 'raftfield-'), 'sm-highwater-', 'highwater-');

UPDATE location_control SET location_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(location_id, 'rustyard-', 'steelbelt-'), 'datavault-sigma-', 'annexes-'), 'blacksite-7-', 'blacksite-'), 'combine-spire-', 'ccs-'), 'tm-coldwater-', 'coldwater-halt-'), 'tm-ironmouth-', 'ironmouth-'), 'tm-marshalling-', 'marshalling-yards-'), 'tm-bonded-', 'bonded-row-'), 'tm-telemetry-', 'telemetry-hill-'), 'tm-viaduct-', 'viaduct-'), 'tm-terminus-', 'last-platform-'), 'tm-blockhouse-', 'blockhouse-'), 'tm-carriage-', 'carriage-'), 'tm-watertower-', 'watertower-'), 'tm-embankment-', 'embankment-'), 'tm-signalrow-', 'signalrow-'), 'sm-tidewalk-', 'tidewalk-'), 'sm-hulls-', 'hulls-'), 'sm-lockgate-', 'lockgate-'), 'sm-quayside-', 'quayside-'), 'sm-fishrow-', 'fishrow-'), 'sm-raftfield-', 'raftfield-'), 'sm-highwater-', 'highwater-');

UPDATE scheduled_battles SET location_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(location_id, 'rustyard-', 'steelbelt-'), 'datavault-sigma-', 'annexes-'), 'blacksite-7-', 'blacksite-'), 'combine-spire-', 'ccs-'), 'tm-coldwater-', 'coldwater-halt-'), 'tm-ironmouth-', 'ironmouth-'), 'tm-marshalling-', 'marshalling-yards-'), 'tm-bonded-', 'bonded-row-'), 'tm-telemetry-', 'telemetry-hill-'), 'tm-viaduct-', 'viaduct-'), 'tm-terminus-', 'last-platform-'), 'tm-blockhouse-', 'blockhouse-'), 'tm-carriage-', 'carriage-'), 'tm-watertower-', 'watertower-'), 'tm-embankment-', 'embankment-'), 'tm-signalrow-', 'signalrow-'), 'sm-tidewalk-', 'tidewalk-'), 'sm-hulls-', 'hulls-'), 'sm-lockgate-', 'lockgate-'), 'sm-quayside-', 'quayside-'), 'sm-fishrow-', 'fishrow-'), 'sm-raftfield-', 'raftfield-'), 'sm-highwater-', 'highwater-');

UPDATE sleeper_cells SET location_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(location_id, 'rustyard-', 'steelbelt-'), 'datavault-sigma-', 'annexes-'), 'blacksite-7-', 'blacksite-'), 'combine-spire-', 'ccs-'), 'tm-coldwater-', 'coldwater-halt-'), 'tm-ironmouth-', 'ironmouth-'), 'tm-marshalling-', 'marshalling-yards-'), 'tm-bonded-', 'bonded-row-'), 'tm-telemetry-', 'telemetry-hill-'), 'tm-viaduct-', 'viaduct-'), 'tm-terminus-', 'last-platform-'), 'tm-blockhouse-', 'blockhouse-'), 'tm-carriage-', 'carriage-'), 'tm-watertower-', 'watertower-'), 'tm-embankment-', 'embankment-'), 'tm-signalrow-', 'signalrow-'), 'sm-tidewalk-', 'tidewalk-'), 'sm-hulls-', 'hulls-'), 'sm-lockgate-', 'lockgate-'), 'sm-quayside-', 'quayside-'), 'sm-fishrow-', 'fishrow-'), 'sm-raftfield-', 'raftfield-'), 'sm-highwater-', 'highwater-');

-- The two stored places, which are JSON and carry either shape.

UPDATE unit_moves SET from_json = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(from_json, '"rustyard', '"steelbelt'), '"datavault-sigma', '"annexes'), '"blacksite-7', '"blacksite'), '"combine-spire', '"ccs'), '"tm-coldwater', '"coldwater-halt'), '"tm-ironmouth', '"ironmouth'), '"tm-marshalling', '"marshalling-yards'), '"tm-bonded', '"bonded-row'), '"tm-telemetry', '"telemetry-hill'), '"tm-viaduct', '"viaduct'), '"tm-terminus', '"last-platform'), '"tm-blockhouse', '"blockhouse'), '"tm-carriage', '"carriage'), '"tm-watertower', '"watertower'), '"tm-embankment', '"embankment'), '"tm-signalrow', '"signalrow'), '"sm-tidewalk', '"tidewalk'), '"sm-hulls', '"hulls'), '"sm-lockgate', '"lockgate'), '"sm-quayside', '"quayside'), '"sm-fishrow', '"fishrow'), '"sm-raftfield', '"raftfield'), '"sm-highwater', '"highwater');

UPDATE unit_moves SET to_json = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(to_json, '"rustyard', '"steelbelt'), '"datavault-sigma', '"annexes'), '"blacksite-7', '"blacksite'), '"combine-spire', '"ccs'), '"tm-coldwater', '"coldwater-halt'), '"tm-ironmouth', '"ironmouth'), '"tm-marshalling', '"marshalling-yards'), '"tm-bonded', '"bonded-row'), '"tm-telemetry', '"telemetry-hill'), '"tm-viaduct', '"viaduct'), '"tm-terminus', '"last-platform'), '"tm-blockhouse', '"blockhouse'), '"tm-carriage', '"carriage'), '"tm-watertower', '"watertower'), '"tm-embankment', '"embankment'), '"tm-signalrow', '"signalrow'), '"sm-tidewalk', '"tidewalk'), '"sm-hulls', '"hulls'), '"sm-lockgate', '"lockgate'), '"sm-quayside', '"quayside'), '"sm-fishrow', '"fishrow'), '"sm-raftfield', '"raftfield'), '"sm-highwater', '"highwater');

UPDATE spy_runs SET target_json = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(target_json, '"rustyard', '"steelbelt'), '"datavault-sigma', '"annexes'), '"blacksite-7', '"blacksite'), '"combine-spire', '"ccs'), '"tm-coldwater', '"coldwater-halt'), '"tm-ironmouth', '"ironmouth'), '"tm-marshalling', '"marshalling-yards'), '"tm-bonded', '"bonded-row'), '"tm-telemetry', '"telemetry-hill'), '"tm-viaduct', '"viaduct'), '"tm-terminus', '"last-platform'), '"tm-blockhouse', '"blockhouse'), '"tm-carriage', '"carriage'), '"tm-watertower', '"watertower'), '"tm-embankment', '"embankment'), '"tm-signalrow', '"signalrow'), '"sm-tidewalk', '"tidewalk'), '"sm-hulls', '"hulls'), '"sm-lockgate', '"lockgate'), '"sm-quayside', '"quayside'), '"sm-fishrow', '"fishrow'), '"sm-raftfield', '"raftfield'), '"sm-highwater', '"highwater');

-- The two keys that are *made* of a district id rather than holding one.
--
-- A scoped tally is `<measure>:<id>` (`crew_tallies`, see 0092) and an area feat's id is
-- `area_<id with underscores>` (`feats/catalog.ts` builds it from the district). Both are written
-- into rows as literal strings, so both moved when the ids did. Left behind, a crew's jobs in the
-- Steelbelt would still be counted under `missions_in_area:rustyard` while the board asked for
-- `missions_in_area:steelbelt`, and four claimed rungs per district would come back unclaimed.
--
-- The tally is rewritten on `:<old>`, which anchors the match to the start of a scope and so also
-- carries a scope that is a *location* (`:rustyard-press` becomes `:steelbelt-press`) without a
-- second pass.

UPDATE crew_tallies SET tally = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(tally, ':rustyard', ':steelbelt'), ':datavault-sigma', ':annexes'), ':blacksite-7', ':blacksite'), ':combine-spire', ':ccs'), ':tm-coldwater', ':coldwater-halt'), ':tm-ironmouth', ':ironmouth'), ':tm-marshalling', ':marshalling-yards'), ':tm-bonded', ':bonded-row'), ':tm-telemetry', ':telemetry-hill'), ':tm-viaduct', ':viaduct'), ':tm-terminus', ':last-platform'), ':tm-blockhouse', ':blockhouse'), ':tm-carriage', ':carriage'), ':tm-watertower', ':watertower'), ':tm-embankment', ':embankment'), ':tm-signalrow', ':signalrow'), ':sm-tidewalk', ':tidewalk'), ':sm-hulls', ':hulls'), ':sm-lockgate', ':lockgate'), ':sm-quayside', ':quayside'), ':sm-fishrow', ':fishrow'), ':sm-raftfield', ':raftfield'), ':sm-highwater', ':highwater');

UPDATE crew_feats SET feat_id = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(feat_id, 'area_rustyard', 'area_steelbelt'), 'area_datavault_sigma', 'area_annexes'), 'area_blacksite_7', 'area_blacksite'), 'area_combine_spire', 'area_ccs'), 'area_tm_coldwater', 'area_coldwater_halt'), 'area_tm_ironmouth', 'area_ironmouth'), 'area_tm_marshalling', 'area_marshalling_yards'), 'area_tm_bonded', 'area_bonded_row'), 'area_tm_telemetry', 'area_telemetry_hill'), 'area_tm_viaduct', 'area_viaduct'), 'area_tm_terminus', 'area_last_platform'), 'area_tm_blockhouse', 'area_blockhouse'), 'area_tm_carriage', 'area_carriage'), 'area_tm_watertower', 'area_watertower'), 'area_tm_embankment', 'area_embankment'), 'area_tm_signalrow', 'area_signalrow'), 'area_sm_tidewalk', 'area_tidewalk'), 'area_sm_hulls', 'area_hulls'), 'area_sm_lockgate', 'area_lockgate'), 'area_sm_quayside', 'area_quayside'), 'area_sm_fishrow', 'area_fishrow'), 'area_sm_raftfield', 'area_raftfield'), 'area_sm_highwater', 'area_highwater');
