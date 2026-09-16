import { CITY_DISTRICTS, districtFrom, type District, type UnifiedBonus } from './districts.js';
import { DEFAULT_CITY_ID } from './cities.js';

/**
 * The other two cities (maintainer request, 2026-09-14).
 *
 * ## Why they are not in `CITY_DISTRICTS`
 *
 * Eighty-one call sites read that array, and every one of them means "the city this crew is
 * standing in": the painted map, the mission board's areas, the control ledger, the seeder, the
 * feats that count contested ground. Appending fourteen districts to it would have silently
 * doubled the map every one of those screens draws, and the first thing to notice would have been a
 * test counting districts rather than anything a player could see.
 *
 * So Ashfall keeps its own array untouched, and the atlas is the layer above: `districtsOfCity`
 * answers for any city, and `ALL_DISTRICTS` is the flat set for the things that genuinely span the
 * world (the standings' "everywhere" scope, `cityOf`). Moving a screen from one to the other is a
 * deliberate edit rather than a surprise.
 *
 * ## What a city is made of
 *
 * Three contested districts and four plots each, which is the shape the maintainer asked for: the
 * same number of homes as Ashfall, and a smaller contested map, so a second city reads as a
 * frontier rather than as a copy of the first. The plots carry no authored name for the reason
 * `UNCLAIMED_DISTRICT_NAME` gives: they are ground a crew moves into, and the name they get is the
 * crew's own.
 *
 * Difficulty runs 1 to 10 across the whole world rather than within a city. Saltmarch is the softer
 * of the two and Verge Station is where the Combine still has soldiers, so a player crossing over
 * is picking an opponent and not only a postcode.
 */

export const SALTMARCH_CITY_ID = 'saltmarch';
export const VERGE_CITY_ID = 'verge-station';

/**
 * Saltmarch: a drowned port that never finished drowning.
 *
 * The sea came up, the Combine wrote the district off, and the people who stayed built upward on
 * the same footings. Everything here is above water on stilts, walkways and moored hulls, which is
 * why its contested ground is about *crossings* rather than about buildings: a bridge is a toll
 * booth when there is no way round it.
 */
const SALTMARCH: readonly District[] = [
  districtFrom({
    id: 'sm-tidewalk',
    cityId: SALTMARCH_CITY_ID,
    name: 'The Tidewalk',
    nickname: 'the Boards',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.22, y: 0.68 },
    difficulty: 2,
    blurb:
      'Two miles of plank walkway over water that used to be a high street. The boards are somebody’s floor, somebody’s shop and somebody’s road all at once, and they rot.',
    locations: [
      ['fishhouse', 'The Salt House', 'market', 'easy'],
      ['pumps', 'The Bilge Pumps', 'water_works', 'easy'],
      ['stilts', 'The Stilt Quarter', 'refugee_camp', 'easy'],
      ['ferry', 'The Pole Ferry', 'tram_depot', 'medium'],
      ['netloft', 'The Net Loft', 'scrap_press', 'easy'],
      ['chapel', 'The Drowned Chapel', 'chapel', 'medium'],
      ['lamp', 'The Lamp Room', 'watchtower', 'hard'],
    ],
  }),
  districtFrom({
    id: 'sm-hulls',
    cityId: SALTMARCH_CITY_ID,
    name: 'The Hulls',
    nickname: 'the Fleet',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.58, y: 0.46 },
    difficulty: 5,
    blurb:
      'Forty ships run aground in a row and welded together. People are born on the Fleet and die on it without once setting foot on ground that does not move.',
    locations: [
      ['keelyard', 'The Keel Yard', 'foundry', 'medium'],
      ['galleys', 'The Long Galleys', 'soup_kitchen', 'easy'],
      ['bilge', 'The Bilge Clinic', 'black_clinic', 'medium'],
      ['boiler', 'The Ship Boilers', 'power_station', 'hard'],
      ['bridgedeck', 'The Bridge Deck', 'high_ground', 'hard'],
      ['hold', 'Number Four Hold', 'pawn_shop', 'easy'],
      ['ropewalk', 'The Ropewalk', 'gym', 'medium'],
    ],
  }),
  districtFrom({
    id: 'sm-lockgate',
    cityId: SALTMARCH_CITY_ID,
    name: 'Lockgate',
    nickname: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.81, y: 0.24 },
    difficulty: 7,
    blurb:
      'The one piece of machinery holding the water where it is. The Combine keeps it, and everyone downstream of it knows exactly what that means.',
    locations: [
      ['sluice', 'The Great Sluice', 'water_works', 'hard'],
      ['winding', 'The Winding House', 'power_station', 'hard'],
      ['tollhouse', 'The Toll House', 'downtown_market', 'medium'],
      ['garrison', 'The Lock Garrison', 'armory', 'hard'],
      ['dredger', 'The Dredger Pen', 'war_machine_graveyard', 'medium'],
      ['siren', 'The Flood Siren', 'broadcast_tower', 'medium'],
      ['drowned', 'The Drowned Field', 'graveyard', 'easy'],
    ],
  }),
  ...plots(SALTMARCH_CITY_ID, [
    [
      'sm-quayside',
      { x: 0.12, y: 0.38 },
      1,
      'Lock-ups along the old quay wall, dry at low tide and reachable by one causeway.',
    ],
    [
      'sm-fishrow',
      { x: 0.36, y: 0.86 },
      2,
      'Smokehouses in a terrace, the whole row permanently warm and permanently smelling of it.',
    ],
    [
      'sm-raftfield',
      { x: 0.68, y: 0.78 },
      2,
      'Homes lashed to pontoons that rise with the water. Nobody here has the same neighbours twice in a year.',
    ],
    [
      'sm-highwater',
      { x: 0.9, y: 0.6 },
      3,
      'The only streets that never flooded, which is why the rent is what it is.',
    ],
  ]),
];

/**
 * Verge Station: the last rail town before the map stops.
 *
 * Built as a junction and abandoned as one, it is where the Combine still keeps real soldiers
 * because it is the road out. The contested ground is infrastructure a supply line cannot do
 * without, which is what makes it the harder of the two cities.
 */
const VERGE: readonly District[] = [
  districtFrom({
    id: 'vs-marshalling',
    cityId: VERGE_CITY_ID,
    name: 'The Marshalling Yards',
    nickname: 'the Yards',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.28, y: 0.74 },
    difficulty: 3,
    blurb:
      'Sixty miles of siding with a thousand wagons parked on it. Whoever sorts the yard decides what leaves this city and when.',
    locations: [
      ['hump', 'The Hump', 'rail_yard', 'medium'],
      ['coalstage', 'The Coaling Stage', 'gas_station', 'easy'],
      ['breakers', 'The Wagon Breakers', 'scrap_press', 'easy'],
      ['signalbox', 'Box Nine', 'watchtower', 'medium'],
      ['messroom', 'The Mess Room', 'tavern', 'easy'],
      ['turntable', 'The Turntable', 'construction_site', 'medium'],
      ['sheds', 'The Running Sheds', 'foundry', 'hard'],
    ],
  }),
  districtFrom({
    id: 'vs-telemetry',
    cityId: VERGE_CITY_ID,
    name: 'Telemetry Hill',
    nickname: 'the Hill',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.62, y: 0.34 },
    difficulty: 6,
    blurb:
      'Dishes and masts on the only rise for forty miles. Everything the Combine knows about the frontier, it knows through here.',
    locations: [
      ['uplink', 'The Uplink Farm', 'satellite_uplink', 'hard'],
      ['repeater', 'The Repeater Mast', 'broadcast_tower', 'medium'],
      ['quiet', 'The Quiet Room', 'university', 'hard'],
      ['pirate', 'Somebody’s Transmitter', 'pirate_radio', 'easy'],
      ['dome', 'The Old Dome', 'planetarium', 'medium'],
      ['array', 'The Ground Array', 'power_station', 'hard'],
      ['bunkroom', 'The Technicians’ Bunkroom', 'refugee_camp', 'easy'],
    ],
  }),
  districtFrom({
    id: 'vs-terminus',
    cityId: VERGE_CITY_ID,
    name: 'The Terminus',
    nickname: 'the Last Platform',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.86, y: 0.62 },
    difficulty: 9,
    blurb:
      'Where the line ends and the checkpoints begin. Everyone who ever left the frontier left from platform one, and the Combine counts every one of them.',
    locations: [
      ['platform', 'Platform One', 'high_ground', 'hard'],
      ['customs', 'The Customs Hall', 'downtown_market', 'hard'],
      ['holding', 'The Holding Pens', 'barricade', 'hard'],
      ['transit', 'The Transit Clinic', 'hospital', 'medium'],
      ['armoury', 'The Platform Armoury', 'armory', 'hard'],
      ['stationmaster', 'The Stationmaster’s Office', 'revolutionist_statue', 'medium'],
      ['sidings', 'The Cold Sidings', 'war_machine_graveyard', 'medium'],
      ['footbridge', 'The Iron Footbridge', 'smugglers_tunnel', 'medium'],
    ],
  }),
  ...plots(VERGE_CITY_ID, [
    [
      'vs-carriage',
      { x: 0.16, y: 0.44 },
      2,
      'Old carriages set on blocks and lived in, a street of them with doors cut in the sides.',
    ],
    [
      'vs-watertower',
      { x: 0.44, y: 0.88 },
      2,
      'A terrace in the shadow of a water tower nobody has drained in thirty years.',
    ],
    [
      'vs-embankment',
      { x: 0.72, y: 0.84 },
      3,
      'Dug into the embankment itself, warm in winter and loud every time something rolls past.',
    ],
    [
      'vs-signalrow',
      { x: 0.94, y: 0.38 },
      3,
      'The signalmen’s cottages, the tidiest street on the frontier and the most watched.',
    ],
  ]),
];

/** The four plots a city gets, which carry no authored name. See `UNCLAIMED_DISTRICT_NAME`. */
function plots(
  cityId: string,
  rows: readonly [
    id: string,
    position: { x: number; y: number },
    difficulty: number,
    blurb: string,
  ][],
): District[] {
  return rows.map(([id, position, difficulty, blurb]) =>
    districtFrom({
      id,
      cityId,
      name: undefined,
      nickname: null,
      kind: 'residential',
      allegiance: 'independent',
      position,
      difficulty,
      blurb,
      locations: [],
    }),
  );
}

/**
 * What finishing one of the new districts is worth.
 *
 * Ashfall gives every contested district one of these and the atlas gave none, so all six could be
 * taken whole and paid nothing for it: a district you can finish and are not rewarded for is a
 * district with no reason to finish. Found by sweeping the new data against the rule
 * `city.test.ts` holds Ashfall to.
 *
 * That rule is the interesting half and it is enforced below: a unified bonus may not be a kind
 * that already appears *inside* its own district. Otherwise completing the ground pays more of
 * exactly what its best location was already paying, and the reward for finishing is
 * indistinguishable from farming one hold.
 */
export const ATLAS_UNIFIED_BONUSES: Readonly<Record<string, UnifiedBonus>> = {
  // Every crossing on the Boards answers to one crew, so nothing on foot is ever the long way
  // round again. The Tidewalk already pays travel and road shortcuts at its own holds, so the
  // reward for the whole is what those cannot buy: the machines move too.
  'sm-tidewalk': { title: 'Every Plank Is Yours', bonus: { kind: 'unit_speed', percent: 12 } },
  // Forty hulls welded together is a yard. Nothing on the Fleet builds anything today, which is
  // exactly why finishing it should.
  'sm-hulls': { title: 'The Fleet Answers', bonus: { kind: 'build_speed', percent: 14 } },
  // Hold the lock and you hold the water: every crew in Saltmarch moves at the level you set it to.
  // Not infamy, which the Lock Garrison inside already pays, and not a discount, which the Toll
  // House does. What only the whole district can sell is the passage itself.
  'sm-lockgate': {
    title: 'The Water Is Yours to Hold',
    bonus: { kind: 'travel_speed', percent: 14 },
  },
  // Sort the yard and you decide what leaves. The Yards already pay build speed and parts inside,
  // so the whole pays in the one thing a junction is actually for: getting there sooner.
  'vs-marshalling': { title: 'You Sort the Yard', bonus: { kind: 'mission_speed', percent: 12 } },
  // Every dish on the Hill pointed where you point it. It pays research inside already; the whole
  // district buys what listening to the Combine's own traffic is really worth.
  'vs-telemetry': {
    title: 'The Hill Listens For You',
    bonus: { kind: 'unit_stealth', percent: 18 },
  },
  // The last platform, and the checkpoints on it. The Terminus pays discounts, marks and vitality
  // inside, so the whole is worth what holding a garrison actually buys: the people on it hit
  // harder. `unit_morale` was the first choice and is the one bonus in the vocabulary carrying a
  // flat figure rather than a percentage, which the schema caught.
  'vs-terminus': {
    title: 'The Last Platform Is Shut',
    bonus: { kind: 'unit_offense', percent: 14 },
  },
};

/** Every district in the world, Ashfall's included, in city order. */
export const ALL_DISTRICTS: readonly District[] = [...CITY_DISTRICTS, ...SALTMARCH, ...VERGE];

const BY_CITY: ReadonlyMap<string, readonly District[]> = new Map([
  [DEFAULT_CITY_ID, CITY_DISTRICTS],
  [SALTMARCH_CITY_ID, SALTMARCH],
  [VERGE_CITY_ID, VERGE],
]);

/** The districts of one city, or nothing for a city id the world does not have. */
export function districtsOfCity(cityId: string): readonly District[] {
  return BY_CITY.get(cityId) ?? [];
}

/**
 * Which city a district is in.
 *
 * It lived in `districts.ts` and was built from `CITY_DISTRICTS` alone, which was correct while
 * Ashfall was the world and wrong the moment it was not: every district in the atlas answered
 * `undefined`, so the standings' "my city" scope would have read a Saltmarch crew as being nowhere.
 * It belongs here because this is the only module that can see all three cities at once.
 */
const DISTRICT_CITY: ReadonlyMap<string, string> = new Map(
  ALL_DISTRICTS.map((district) => [district.id, district.cityId]),
);

export function cityOf(districtId: string): string | undefined {
  return DISTRICT_CITY.get(districtId);
}

/** How many of each kind a city holds, for the card on the cities screen. */
export function cityCounts(cityId: string): { contested: number; plots: number } {
  const districts = districtsOfCity(cityId);
  return {
    contested: districts.filter((one) => one.kind === 'contested').length,
    plots: districts.filter((one) => one.kind === 'residential').length,
  };
}
