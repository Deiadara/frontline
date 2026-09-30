import {
  CITY_DISTRICTS,
  UNIFIED_BONUSES,
  districtFrom,
  type District,
  type UnifiedBonus,
} from './districts.js';
import type { Location } from './locations.js';
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
export const TERMINUS_CITY_ID = 'terminus';

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
    id: 'tidewalk',
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
      ['fishhouse', 'The Salt House', 'market'],
      ['pumps', 'The Bilge Pumps', 'water_works'],
      ['stilts', 'The Stilt Quarter', 'refugee_camp'],
      ['ferry', 'The Pole Ferry', 'tram_depot'],
      ['netloft', 'The Net Loft', 'scrap_press'],
      ['chapel', 'The Drowned Chapel', 'chapel'],
      ['lamp', 'The Lamp Room', 'watchtower'],
    ],
  }),
  districtFrom({
    id: 'hulls',
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
      ['keelyard', 'The Keel Yard', 'foundry'],
      ['galleys', 'The Long Galleys', 'soup_kitchen'],
      ['bilge', 'The Bilge Clinic', 'black_clinic'],
      ['boiler', 'The Ship Boilers', 'power_station'],
      ['bridgedeck', 'The Bridge Deck', 'high_ground'],
      ['hold', 'Number Four Hold', 'pawn_shop'],
      ['ropewalk', 'The Ropewalk', 'gym'],
    ],
  }),
  districtFrom({
    id: 'lockgate',
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
      ['sluice', 'The Great Sluice', 'water_works'],
      ['winding', 'The Winding House', 'power_station'],
      ['tollhouse', 'The Toll House', 'downtown_market'],
      ['garrison', 'The Lock Garrison', 'armory'],
      ['dredger', 'The Dredger Pen', 'war_machine_graveyard'],
      ['siren', 'The Flood Siren', 'broadcast_tower'],
      ['drowned', 'The Drowned Field', 'graveyard'],
    ],
  }),
  ...plots(SALTMARCH_CITY_ID, [
    [
      'quayside',
      { x: 0.12, y: 0.38 },
      'Lock-ups along the old quay wall, dry at low tide and reachable by one causeway.',
    ],
    [
      'fishrow',
      { x: 0.36, y: 0.86 },
      'Smokehouses in a terrace, the whole row permanently warm and permanently smelling of it.',
    ],
    [
      'raftfield',
      { x: 0.68, y: 0.78 },
      'Homes lashed to pontoons that rise with the water. Nobody here has the same neighbours twice in a year.',
    ],
    [
      'highwater',
      { x: 0.9, y: 0.6 },
      'The only streets that never flooded, which is why the rent is what it is.',
    ],
  ]),
];

/**
 * Terminus: the last rail town before the map stops (maintainer, 2026-09-24).
 *
 * Authored as **Verge Station** with three contested districts and no server behind it, and grown
 * here to Ashfall's size: twelve districts, eight contested holding sixty locations between them,
 * and four plots. `docs/DISTRICTS.md` is the design and this is the data; if the two disagree the
 * source is right.
 *
 * Built as a junction and abandoned as one, Terminus is where the Combine still keeps real
 * soldiers, because it is the only road out of the frontier. Where Ashfall is a city that was
 * taken, Terminus is a city that is still being held, and the difference shows in what there is to
 * fight over: not a power spine and a tech park, but a line, and everything the line needs to run.
 *
 * ## The railway
 *
 * Seven of the eight contested districts hold exactly one `rail_station`. Telemetry Hill does not:
 * the line runs past the foot of the ridge and does not climb it, which is the whole point of the
 * Hill being the odd district out, and it makes the hardest intel ground in the city the ground
 * the railway will not take you to. Five of the seven platforms are `hard` to fortify, and a
 * Station is one location rather than a district, so a rival does not have to break your city to
 * break your railway: only to take one platform. That is what the line is actually fought over.
 *
 * ## The climb
 *
 * West to east along the line, bottom left to top right, so difficulty and height run the same
 * direction they do in Ashfall. Telemetry Hill is the one inversion: it sits higher than the
 * harder Viaduct because it is literally a hill, off the line and above it.
 */
const TERMINUS: readonly District[] = [
  districtFrom({
    id: 'coldwater-halt',
    cityId: TERMINUS_CITY_ID,
    name: 'Coldwater Halt',
    nickname: 'the Halt',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.08, y: 0.9 },
    difficulty: 1,
    blurb:
      'A request stop on the flats at the west end, where the line crosses forty miles of nothing. The train stops here because there is a town, and there is a town because the train stops here.',
    locations: [
      ['platform', 'Coldwater Platform', 'rail_station'],
      ['market', 'The Halt Market', 'market'],
      ['standpipe', 'The Standpipe', 'water_works'],
      ['kitchens', 'Trackside Kitchens', 'soup_kitchen'],
      ['fuelling', 'The Fuelling Point', 'gas_station'],
      ['tentrow', 'Tent Row', 'refugee_camp'],
      ['signal', 'The Distant Signal', 'watchtower'],
    ],
  }),
  districtFrom({
    id: 'ironmouth',
    cityId: TERMINUS_CITY_ID,
    name: 'Ironmouth',
    nickname: 'the Cutting',
    kind: 'contested',
    // Looter ground. `allegiance` says only whether the Combine owns it; who stands on the plots
    // of everything else is `startingHolder`, and how many of them is `SQUATTED_PLACES` below.
    allegiance: 'independent',
    position: { x: 0.22, y: 0.8 },
    difficulty: 2,
    blurb:
      'The west tunnel mouth, where the line goes under the ridge. A town grew in the cutting either side of it and then grew into it: the ventilation shafts are streets, and the bricked arches are houses.',
    locations: [
      ['halt', 'Ironmouth Halt', 'rail_station'],
      ['shafts', 'The Ventilation Shafts', 'sewer_junction'],
      ['arches', 'The Bricked Arches', 'smugglers_tunnel'],
      ['shaftnine', 'Shaft Nine', 'chemical_plant'],
      ['spoil', 'The Spoil Heap', 'scrap_press'],
      ['chapel', 'The Tunnel Chapel', 'chapel'],
      ['lampman', 'Lampman’s Row', 'pawn_shop'],
    ],
  }),
  districtFrom({
    id: 'marshalling-yards',
    cityId: TERMINUS_CITY_ID,
    name: 'The Marshalling Yards',
    nickname: 'the Yards',
    kind: 'contested',
    allegiance: 'independent',
    position: { x: 0.34, y: 0.7 },
    difficulty: 3,
    blurb:
      'Sixty miles of siding with a thousand wagons parked on it. Whoever sorts the yard decides what leaves this city and when.',
    locations: [
      ['hump', 'The Hump', 'rail_yard'],
      // Was the Turntable, a construction site. The working heart of the railway could not be the
      // one part of it without a platform (maintainer, 2026-09-24).
      ['platformfour', 'Platform Four', 'rail_station'],
      ['coalstage', 'The Coaling Stage', 'gas_station'],
      ['breakers', 'The Wagon Breakers', 'scrap_press'],
      ['signalbox', 'Box Nine', 'watchtower'],
      ['messroom', 'The Mess Room', 'tavern'],
      ['sheds', 'The Running Sheds', 'foundry'],
    ],
  }),
  districtFrom({
    id: 'bonded-row',
    cityId: TERMINUS_CITY_ID,
    name: 'Bonded Row',
    nickname: 'the Bond',
    kind: 'contested',
    // Looter ground, same as Ironmouth: see the note there.
    allegiance: 'independent',
    position: { x: 0.47, y: 0.6 },
    difficulty: 4,
    blurb:
      'Bonded warehouses, where freight waited for a clearance that stopped coming. The paperwork is still in the office and the crates are still on the floor, and everybody in the city knows which is which.',
    locations: [
      ['halt', 'Bond Street Halt', 'rail_station'],
      ['longbond', 'The Long Bond', 'downtown_market'],
      ['seized', 'The Seized Goods Office', 'pawn_shop'],
      ['rendering', 'The Rendering Shed', 'bone_market'],
      ['crated', 'The Crated Yard', 'construction_site'],
      ['kennels', 'The Kennels', 'doghouse'],
      ['coldstore', 'The Cold Store', 'black_clinic'],
      ['ring', 'The Crate Ring', 'fight_pit'],
    ],
  }),
  districtFrom({
    id: 'telemetry-hill',
    cityId: TERMINUS_CITY_ID,
    name: 'Telemetry Hill',
    nickname: 'the Hill',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.62, y: 0.34 },
    difficulty: 6,
    blurb:
      'Dishes and masts on the only rise for forty miles. Everything the Combine knows about the frontier, it knows through here.',
    locations: [
      ['uplink', 'The Uplink Farm', 'satellite_uplink'],
      ['repeater', 'The Repeater Mast', 'broadcast_tower'],
      ['quiet', 'The Quiet Room', 'university'],
      ['pirate', 'Somebody’s Transmitter', 'pirate_radio'],
      ['dome', 'The Old Dome', 'planetarium'],
      ['array', 'The Ground Array', 'power_station'],
      ['bunkroom', 'The Technicians’ Bunkroom', 'refugee_camp'],
    ],
  }),
  districtFrom({
    id: 'viaduct',
    cityId: TERMINUS_CITY_ID,
    name: 'The Viaduct',
    nickname: 'the Arches',
    kind: 'contested',
    allegiance: 'government',
    position: { x: 0.58, y: 0.48 },
    difficulty: 7,
    blurb:
      'Forty brick arches carrying the line over the river gorge, and the Combine holds every one of them, because there is no line without them. Each arch is bricked up into something: a workshop, a barracks, a clinic nobody asks about.',
    locations: [
      ['halt', 'Viaduct Halt', 'rail_station'],
      ['battery', 'The Arch Battery', 'barricade'],
      ['parapet', 'The Parapet', 'high_ground'],
      ['gantry', 'The Gantry Walk', 'tram_depot'],
      ['archnineteen', 'Arch Nineteen', 'mad_scientist_lair'],
      ['pierworks', 'The Pier Works', 'foundry'],
      ['sappers', 'The Sappers’ Store', 'armory'],
      ['undercroft', 'The Undercroft', 'gene_clinic'],
    ],
  }),
  districtFrom({
    id: 'last-platform',
    cityId: TERMINUS_CITY_ID,
    name: 'The Last Platform',
    nickname: 'Platform One',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.8, y: 0.34 },
    difficulty: 9,
    blurb:
      'Where the line ends and the checkpoints begin. Everyone who ever left the frontier left from platform one, and the Combine counts every one of them.',
    locations: [
      // Was high ground. The end of the line has to be on the line (maintainer, 2026-09-24).
      ['platform', 'Platform One', 'rail_station'],
      ['customs', 'The Customs Hall', 'downtown_market'],
      ['holding', 'The Holding Pens', 'barricade'],
      ['transit', 'The Transit Clinic', 'hospital'],
      ['armoury', 'The Platform Armoury', 'armory'],
      ['stationmaster', 'The Stationmaster’s Office', 'revolutionist_statue'],
      ['sidings', 'The Cold Sidings', 'war_machine_graveyard'],
      ['footbridge', 'The Iron Footbridge', 'smugglers_tunnel'],
    ],
  }),
  districtFrom({
    id: 'blockhouse',
    cityId: TERMINUS_CITY_ID,
    name: 'The Blockhouse',
    nickname: 'Control',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.9, y: 0.16 },
    difficulty: 10,
    blurb:
      'The signalling centre that owns every point and every signal on the frontier line, with the regional garrison built around it. Whoever sits in Control decides which trains exist.',
    locations: [
      ['officershalt', 'The Officers’ Halt', 'rail_station'],
      ['panel', 'The Panel', 'broadcast_station'],
      ['chapel', 'The Frontier Chapel', 'combine_chapel'],
      ['interlocking', 'The Interlocking', 'power_station'],
      ['records', 'The Records Office', 'university'],
      ['parade', 'The Parade Ground', 'gym'],
      ['reactor', 'The Reactor Shed', 'nuclear_plant'],
      ['towerbox', 'The Tower Box', 'watchtower'],
    ],
  }),
  ...plots(TERMINUS_CITY_ID, [
    [
      'carriage',
      { x: 0.14, y: 0.64 },
      'Old carriages set on blocks and lived in, a street of them with doors cut in the sides.',
    ],
    [
      'watertower',
      { x: 0.38, y: 0.88 },
      'A terrace in the shadow of a water tower nobody has drained in thirty years. Everybody who lives there knows exactly how much is still in it.',
    ],
    [
      'embankment',
      { x: 0.7, y: 0.84 },
      'Dug into the embankment itself, warm in winter and loud every time something rolls past.',
    ],
    [
      'signalrow',
      { x: 0.94, y: 0.56 },
      'The signalmen’s cottages, the tidiest street on the frontier and the most watched. It sits under the Blockhouse, which is the right address for a rival and the wrong one for a beginner.',
    ],
  ]),
];

/** The four plots a city gets, which carry no authored name. See `UNCLAIMED_DISTRICT_NAME`. */
function plots(
  cityId: string,
  rows: readonly [id: string, position: { x: number; y: number }, blurb: string][],
): District[] {
  return rows.map(([id, position, blurb]) =>
    districtFrom({
      id,
      cityId,
      name: undefined,
      nickname: null,
      kind: 'residential',
      allegiance: 'independent',
      position,
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
  tidewalk: { title: 'Every Plank Is Yours', bonus: { kind: 'unit_speed', percent: 12 } },
  // Forty hulls welded together is a yard. Nothing on the Fleet builds anything today, which is
  // exactly why finishing it should.
  hulls: { title: 'The Fleet Answers', bonus: { kind: 'build_speed', percent: 14 } },
  // Hold the lock and you hold the water, and your crews move faster on every road in every city
  // for it. Not infamy, which the Lock Garrison inside already pays, and not a discount, which the Toll
  // House does. What only the whole district can sell is the passage itself.
  lockgate: {
    title: 'The Water Is Yours to Hold',
    bonus: { kind: 'travel_speed', percent: 14 },
  },
  // Whoever owns the platform decides what comes off it, so every crew you send anywhere comes
  // back carrying more. The Halt pays supplies and beds inside; what only the whole stop can sell
  // is the freight.
  'coldwater-halt': {
    title: 'Everything Off the Train',
    bonus: { kind: 'loot_capacity', percent: 15 },
  },
  // People who live inside a hill are hard to get out of it. Deliberately not more stealth: the
  // shafts already pay that, and a crew that has taken a hill should be harder to shift
  // everywhere, not sneakier in one place.
  ironmouth: { title: 'Nobody Digs You Out', bonus: { kind: 'defense_percent', percent: 10 } },
  // Sort the yard and you decide what leaves. The Yards already pay parts and travel inside, so
  // the whole pays in the one thing a junction is actually for: getting there sooner.
  'marshalling-yards': {
    title: 'You Sort the Yard',
    bonus: { kind: 'mission_speed', percent: 12 },
  },
  // Not another discount on the ordinary market, which the Long Bond inside already pays: what
  // the whole district buys is the other counter.
  'bonded-row': {
    title: 'The Bond Is Open',
    bonus: { kind: 'black_market_discount', percent: 15 },
  },
  // Every dish on the Hill pointed where you point it. It pays research inside already; the whole
  // district buys what listening to the Combine's own traffic is really worth.
  'telemetry-hill': {
    title: 'The Hill Listens For You',
    bonus: { kind: 'unit_stealth', percent: 18 },
  },
  // Taking the viaduct is the most visible thing anybody can do in this city, and the whole world
  // prices you differently afterwards: the infamy counts everywhere.
  viaduct: {
    title: 'They Watched You Take the Arches',
    bonus: { kind: 'infamy_gain', percent: 15 },
  },
  // The last platform, and the checkpoints on it. It pays discounts, marks and vitality inside, so
  // the whole is worth what holding a garrison actually buys: the people on it hit harder.
  'last-platform': {
    title: 'The Last Platform Is Shut',
    bonus: { kind: 'unit_offense', percent: 14 },
  },
  /*
   * Control decides which trains exist, and the maintainer's call (2026-09-24) is that what that
   * is worth is twenty per cent off the time every job in this city takes. In this city only
   * (`inOwnCity`, maintainer 2026-09-30): it paid on every board in the world until then.
   *
   * Written as `25` because a speed channel is spent as `time / (1 + percent/100)`, and 25 there
   * is exactly a fifth off the clock (`timeSavingPercent`). The card says "-20% mission time",
   * which is the number that was asked for, and "in this city".
   *
   * The same kind the Yards pay, which is allowed and is the point: the rule the suite enforces is
   * that a district's unified bonus may not be a kind that already appears *inside that district*,
   * and nothing in the Blockhouse pays mission speed. A crew holding both ends of the line gets
   * both, which is the strongest economy in the game and costs the whole city to assemble.
   */
  blockhouse: {
    title: 'Everything Leaves Through You',
    bonus: { kind: 'mission_speed', percent: 25, inOwnCity: true },
  },
};

/** Every district in the world, Ashfall's included, in city order. */
export const ALL_DISTRICTS: readonly District[] = [...CITY_DISTRICTS, ...TERMINUS, ...SALTMARCH];

const BY_CITY: ReadonlyMap<string, readonly District[]> = new Map([
  [DEFAULT_CITY_ID, CITY_DISTRICTS],
  [TERMINUS_CITY_ID, TERMINUS],
  [SALTMARCH_CITY_ID, SALTMARCH],
]);

/**
 * The world's lookups, and the reason they live here rather than in `districts.ts`.
 *
 * `findDistrict` and `findLocation` used to walk Ashfall's twelve districts, because Ashfall was
 * the world. Every action verb in the game resolves its target through one of them: march, move,
 * spy, raid, garrison, upgrade, fortify. While there was one playable city that was
 * correct; the day a second one opened it became a wall with the wrong sign on it, refusing a real
 * Terminus location as "no such place" (maintainer, 2026-09-24).
 *
 * They are here because this is the only module that can see every city: `atlas.ts` imports
 * `districts.ts`, so `districts.ts` cannot import back. The names did not change, and the package
 * barrel exports both modules, so nothing that imports from `@frontline/shared` had to move.
 * Ashfall's own versions are still there under {@link findAshfallDistrict} and
 * {@link findAshfallLocation}, for the handful of places that really do mean "the first city".
 */
export const EVERY_LOCATION: readonly Location[] = ALL_DISTRICTS.flatMap(
  (district) => district.locations,
);

export function findDistrict(districtId: string): District | undefined {
  return ALL_DISTRICTS.find((district) => district.id === districtId);
}

export function findLocation(locationId: string): Location | undefined {
  return EVERY_LOCATION.find((location) => location.id === locationId);
}

/**
 * What holding the whole of `districtId` is worth, or `null` for ground with nothing to hold.
 *
 * Reads both tables. Ashfall's is authored in `districts.ts` beside its map and the other cities'
 * is authored here beside theirs, which is the right place for each; what was wrong was that only
 * the first one was ever read, so eight authored Terminus bonuses were dead data and a crew that
 * took a district end to end in the second city was paid nothing for it.
 */
export function unifiedBonusFor(districtId: string): UnifiedBonus | null {
  return UNIFIED_BONUSES[districtId] ?? ATLAS_UNIFIED_BONUSES[districtId] ?? null;
}

/**
 * The same integrity guard `districts.ts` runs over Ashfall, run over everywhere else.
 *
 * Ashfall's version has caught a missing unified bonus twice. The atlas had no equivalent, so the
 * same defect in another city surfaced as a `null` on a tooltip instead of a failure to boot.
 */
for (const district of ALL_DISTRICTS) {
  const contested = district.kind === 'contested';
  if (contested && district.locations.length === 0) {
    throw new Error(`${district.id} is contested but has nothing in it to take`);
  }
  if (!contested && district.locations.length > 0) {
    throw new Error(`${district.id} is residential and cannot hold capturable locations`);
  }
  if (contested && unifiedBonusFor(district.id) === null) {
    throw new Error(`${district.id} is contested but has no unified bonus`);
  }
}

if (new Set(EVERY_LOCATION.map((location) => location.id)).size !== EVERY_LOCATION.length) {
  throw new Error('two locations share an id');
}

if (new Set(ALL_DISTRICTS.map((district) => district.id)).size !== ALL_DISTRICTS.length) {
  throw new Error('two districts share an id');
}

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
