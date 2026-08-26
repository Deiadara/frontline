import { z } from 'zod';
import { FactionSchema, governmentGarrisonFor, type Faction } from '../factions.js';
import { IdSchema } from './../primitives.js';
import {
  FortifyDifficultySchema,
  LocationKindSchema,
  type HoldBonus,
  type Location,
  type LocationKind,
} from './locations.js';

/**
 * The city (GDD §A4): ten districts, hard-authored, with the locations inside them.
 *
 * Two kinds of ground, and the difference is the whole shape of the game:
 *
 *   * **Residential** districts hold crews. A crew's own district is its base: the thirteen
 *     structures of §A1, and it can be *raided* but never taken. Losing everything you have built
 *     because you were asleep is not a strategy game, it is a punishment.
 *   * **Contested** districts hold **locations**: a substation, a pawn shop, a war machine graveyard.
 *     Each is held by somebody, each is takeable on its own, and each pays for as long as you keep
 *     it. Take every location in a district and the district is yours, which pays again.
 *
 * Nothing here is generated. A map is only worth learning if it is the same map tomorrow.
 */

export const DISTRICT_KINDS = ['residential', 'contested'] as const;
export const DistrictKindSchema = z.enum(DISTRICT_KINDS);
export type DistrictKind = z.infer<typeof DistrictKindSchema>;

/** Normalized 0..1 map coordinates: the renderer scales to its viewport. */
export const PositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type Position = z.infer<typeof PositionSchema>;

export const DistrictSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /**
   * What the street calls it: "the Tech District", "the Old City Center". Not every district has
   * one, and the ones that do not are more interesting for it: a nickname is something a location
   * earns.
   */
  nickname: z.string().min(1).nullable(),
  kind: DistrictKindSchema,
  /** Whose ground this nominally is (§A3), before anybody starts taking it off them. */
  faction: FactionSchema,
  /** A seat of the Combine's power rather than one of its holdings: see §D8's `Revolutionary`. */
  seatOfPower: z.boolean(),
  position: PositionSchema,
  difficulty: z.number().int().min(1).max(10),
  blurb: z.string().min(1),
  locations: z.array(
    z.object({
      id: z.string().min(1),
      districtId: z.string().min(1),
      name: z.string().min(1),
      kind: LocationKindSchema,
      fortifyDifficulty: FortifyDifficultySchema,
    }),
  ),
});
export type District = z.infer<typeof DistrictSchema>;

/** District new crews are settled into. */
export const STARTER_DISTRICT_ID = 'neon-docks';

/** District held by the seeded AI rival. */
export const BOT_DISTRICT_ID = 'ashen-terraces';

/** What holding every location in a district is worth on top of the locations themselves. */
export interface UnifiedBonus {
  /** Named, because "you have taken the whole district" deserves to be said out loud. */
  title: string;
  bonus: HoldBonus;
}

/**
 * The §A4 unified bonus per contested district.
 *
 * Each is deliberately something *other* than what its own locations give, so a district is worth
 * completing rather than worth farming the best location in: the Scrapfields are full of scrap, and
 * finishing them buys cheaper troops instead of yet more scrap. `city.test.ts` enforces that:
 * a unified bonus whose effect kind already appears inside its own district fails the suite.
 */
export const UNIFIED_BONUSES: Readonly<Record<string, UnifiedBonus>> = {
  rustyard: {
    title: 'Run of the Scrapfields',
    bonus: { kind: 'training_cost', percent: 10 },
  },
  'chrome-row': {
    title: 'The Row Runs For You',
    // Downtown end to end: everybody who moves anything in this city owes somebody here, and
    // every crew you send out is back sooner for it. Deliberately not more morale: the Regal
    // and the Cracked Anvil are already in this district and pay in exactly that.
    bonus: { kind: 'mission_speed', percent: 10 },
  },
  undergrid: {
    title: 'Hand on the Power Spine',
    bonus: { kind: 'build_speed', percent: 12 },
  },
  'datavault-sigma': {
    title: 'The Faculty Answers To You',
    bonus: { kind: 'unit_stealth', percent: 20 },
  },
  'glasshouse-fields': {
    title: 'The Green Belt Is Fed',
    bonus: { kind: 'training_speed', percent: 15 },
  },
  'blacksite-7': {
    title: 'The Garrison Is Yours',
    bonus: { kind: 'unit_offense', percent: 15 },
  },
  'combine-spire': {
    title: 'The Spire Is Taken',
    // The last district in the game, and the bonus is the Combine's own machinery rather than a
    // pile of anything: every price in this city was set from these offices, and now you set it.
    // Not infamy, tempting as that is: the Martyrs' Ground inside these walls already pays in
    // exactly that, and a unified bonus has to be worth *finishing* the district for.
    bonus: { kind: 'market_discount', percent: 20 },
  },
};

/** Terser than repeating the district id in every location literal. */
function locationsIn(
  districtId: string,
  rows: readonly [
    slug: string,
    name: string,
    kind: LocationKind,
    fortify: Location['fortifyDifficulty'],
  ][],
): Location[] {
  return rows.map(([slug, name, kind, fortifyDifficulty]) => ({
    id: `${districtId}-${slug}`,
    districtId,
    name,
    kind,
    fortifyDifficulty,
  }));
}

/**
 * The city, laid out as a location rather than as ten points scattered in a box.
 *
 * `position` used to be arbitrary, and it showed: difficulty jumped around the map, the two
 * government seats sat in opposite corners for no reason, and a player had no way to read where
 * they were in the world from where they were on it.
 *
 * It is a **climb** now. The water and the crews are at the bottom: the Docks, Kettle Row and the
 * Rustyard, the three cheapest locations in the game, and the Directorate is at the top, with the
 * Combine Spire looking down the middle of the frame from the highest point on it. Difficulty rises
 * with height almost monotonically, so "further up" and "harder" are the same direction, and a
 * player who has taken the low ground can see what the next rung is without opening anything.
 *
 * Faction reads left-to-right within that: independent ground on the flanks, the Directorate's
 * holdings up the centre and the right, which is why the Blacksite and the Datavault bracket the
 * approach to the Spire. `city.test.ts` pins the gradient and the spacing so a future district
 * cannot be dropped in on top of another one.
 */
export const CITY_DISTRICTS: readonly District[] = [
  // --- residential: crews live here, and nobody takes these ---
  {
    id: 'neon-docks',
    name: 'Neon Docks',
    nickname: 'the Docks',
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.15, y: 0.9 },
    difficulty: 1,
    blurb:
      'Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.',
    locations: [],
  },
  {
    id: 'ashen-terraces',
    name: 'Ashen Terraces',
    nickname: null,
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.84, y: 0.62 },
    difficulty: 4,
    blurb:
      'Stepped tenements up the northern slope, burnt once and rebuilt out of what was left. Whoever holds it can see the whole city coming.',
    locations: [],
  },
  {
    id: 'kettle-row',
    name: 'Kettle Row',
    nickname: null,
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.38, y: 0.82 },
    difficulty: 2,
    blurb:
      'A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.',
    locations: [],
  },

  // --- contested: this is what there is to fight over ---
  {
    id: 'rustyard',
    name: 'The Rustyard',
    nickname: 'the Scrapfields',
    kind: 'contested',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.63, y: 0.83 },
    difficulty: 2,
    blurb:
      'Square kilometres of sorted wreckage, worked by whoever got there first. The looters here are disorganised, which is the only reason anybody starts a war on this ground.',
    locations: locationsIn('rustyard', [
      ['press', 'Kessler Press', 'scrap_press', 'easy'],
      ['bonefield', 'The Bonefield', 'war_machine_graveyard', 'hard'],
      ['pawn', 'Ninth Street Pawn', 'pawn_shop', 'easy'],
      ['ramp', 'The Ramp', 'skate_ground', 'easy'],
      ['pumps', 'Carrion Row Pumps', 'gas_station', 'easy'],
      ['kennels', 'The Doghouse', 'doghouse', 'medium'],
      ['bones', 'The Bone Market', 'bone_market', 'easy'],
    ]),
  },
  {
    id: 'chrome-row',
    name: 'Chrome Row',
    nickname: 'the Old City Center',
    kind: 'contested',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.3, y: 0.62 },
    difficulty: 4,
    blurb:
      'What is left of downtown: bank halls turned into markets, a picture house that never closed, and a transmitter mast nobody has managed to hold for a whole season.',
    locations: locationsIn('chrome-row', [
      ['exchange', 'The Exchange', 'downtown_market', 'medium'],
      ['cathode', 'Cathode Tower', 'broadcast_tower', 'hard'],
      ['overlook', 'The Overlook', 'high_ground', 'hard'],
      ['ferrous', 'Saint Ferrous', 'hospital', 'easy'],
      ['longpawn', 'The Long Pawn', 'pawn_shop', 'easy'],
      ['regal', 'The Regal', 'cinema', 'easy'],
      ['anvil', 'The Cracked Anvil', 'tavern', 'medium'],
      ['coinop', 'Coin-Op Row', 'arcade', 'easy'],
    ]),
  },
  {
    id: 'undergrid',
    name: 'The Undergrid',
    nickname: 'the Power Spine',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.55, y: 0.58 },
    difficulty: 5,
    blurb:
      'The Combine meters the whole undercity from down here. Bundled conduit running the walls like roots, transformer housings the size of buildings, and older tunnels underneath that are on nobody’s drawings.',
    locations: locationsIn('undergrid', [
      ['substation', 'Undergrid Substation', 'power_station', 'hard'],
      ['vault9', 'Transformer Vault 9', 'power_station', 'hard'],
      ['junction', 'The Weeping Junction', 'sewer_junction', 'easy'],
      ['reagent', 'Reagent Works', 'chemical_plant', 'medium'],
      ['customs', 'The Old Customs Run', 'smugglers_tunnel', 'medium'],
      ['depot', 'Lamplight Depot', 'tram_depot', 'medium'],
      ['lair', 'The Laundry Stair', 'mad_scientist_lair', 'hard'],
    ]),
  },
  {
    id: 'datavault-sigma',
    name: 'Datavault Sigma',
    nickname: 'the Tech District',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.76, y: 0.38 },
    difficulty: 6,
    blurb:
      'Faculty buildings the Combine never closed, because it was easier to move in. Everything worth knowing in this city is written down somewhere in here.',
    locations: locationsIn('datavault-sigma', [
      ['faculty', 'Sigma Faculty', 'university', 'medium'],
      ['uplink', 'Uplink Sigma', 'satellite_uplink', 'hard'],
      ['ward', 'The Quiet Ward', 'gene_clinic', 'hard'],
      ['coldrow', 'Cold Row', 'foundry', 'medium'],
      ['orrery', 'The Orrery', 'planetarium', 'medium'],
      ['loft', 'Nine Roofs', 'pirate_radio', 'easy'],
      // The half-built faculty tower. Also the only crane in the city outside the Spire: see the
      // note on the Colossus in `units/catalog.ts` for why that matters.
      ['scaffold', 'The Unfinished Faculty', 'construction_site', 'hard'],
    ]),
  },
  {
    id: 'glasshouse-fields',
    name: 'Glasshouse Fields',
    nickname: 'the Green Belt',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.1, y: 0.58 },
    difficulty: 3,
    blurb:
      'State hydroponics behind a fence. Everything the undercity eats is grown here, and none of it is sold here.',
    locations: locationsIn('glasshouse-fields', [
      ['intake', 'Glasshouse Intake', 'water_works', 'medium'],
      ['fieldgate', 'Fieldgate Market', 'market', 'easy'],
      ['berm', 'The Berm', 'high_ground', 'easy'],
      ['haulers', 'Hauler Yard', 'rail_yard', 'medium'],
      ['ladle', 'The Long Ladle', 'soup_kitchen', 'easy'],
      ['fieldchapel', 'Chapel of the Furrow', 'chapel', 'easy'],
      // Against the fence, on the wrong side of the food.
      ['fence', 'The Fence Camp', 'refugee_camp', 'easy'],
    ]),
  },
  {
    id: 'blacksite-7',
    name: 'Blacksite 7',
    nickname: 'the Military District',
    kind: 'contested',
    faction: 'government',
    seatOfPower: true,
    position: { x: 0.33, y: 0.3 },
    difficulty: 8,
    blurb:
      'Hardened ferrocrete, layered berms, and a Directorate rifle company that has never had to leave. The first place anyone learns not to walk into.',
    locations: locationsIn('blacksite-7', [
      ['armory', 'Blacksite Armory', 'armory', 'hard'],
      ['outer', 'Outer Berm', 'barricade', 'hard'],
      ['watchtower', 'The Watchtower', 'watchtower', 'hard'],
      ['pit17', 'Pit Seventeen', 'fight_pit', 'medium'],
      ['motorpool', 'Motor Pool Seven', 'war_machine_graveyard', 'hard'],
      ['drill', 'The Drill Hall', 'gym', 'medium'],
      ['blackward', 'Ward Nine', 'black_clinic', 'hard'],
      ['pile', 'The Pile', 'nuclear_plant', 'hard'],
    ]),
  },
  {
    id: 'combine-spire',
    name: 'Spire of the Combine',
    nickname: 'the Spire',
    kind: 'contested',
    faction: 'government',
    seatOfPower: true,
    position: { x: 0.57, y: 0.13 },
    difficulty: 10,
    blurb:
      'The surface spire the government rules from, and the household guard that has never been tested. Taking this is not a raid. It is the end of something.',
    locations: locationsIn('combine-spire', [
      ['uplink', 'Spire Uplink', 'satellite_uplink', 'hard'],
      ['armory', 'Directorate Armory', 'armory', 'hard'],
      ['household', 'The Household Barricade', 'barricade', 'hard'],
      ['broadcast', 'Spire Broadcast', 'broadcast_station', 'hard'],
      ['ascension', 'The Ascension Clinic', 'gene_clinic', 'hard'],
      ['scaffold', 'The Unfinished Wing', 'construction_site', 'hard'],
      ['martyrs', 'The Martyrs’ Ground', 'graveyard', 'medium'],
      ['statue', 'Statue of the Revolutionist', 'revolutionist_statue', 'medium'],
    ]),
  },
];

export function findDistrict(districtId: string): District | undefined {
  return CITY_DISTRICTS.find((district) => district.id === districtId);
}

/** Every authored location in the city, flattened. */
export const CITY_LOCATIONS: readonly Location[] = CITY_DISTRICTS.flatMap(
  (district) => district.locations,
);

export function findLocation(locationId: string): Location | undefined {
  return CITY_LOCATIONS.find((location) => location.id === locationId);
}

/** Districts a crew can settle in. Contested ground holds locations, not homes. */
export const RESIDENTIAL_DISTRICTS: readonly District[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'residential',
);

/** Districts with something in them to take. */
export const CONTESTED_DISTRICTS: readonly District[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'contested',
);

/**
 * A seat of the government's power rather than one of its holdings (§A3): what you have to take
 * to be *replacing* the Combine instead of merely robbing it. That is the whole difference between
 * §D8's `Anti-systemic` and `Revolutionary`.
 */
export function isSeatOfGovernmentPower(district: District): boolean {
  return district.faction === 'government' && district.seatOfPower;
}

/** The garrison standing on a district when the strike team arrives (§A3). */
export function garrisonOf(district: District): string {
  return district.faction === 'government'
    ? governmentGarrisonFor(district.difficulty)
    : 'whoever holds the ground and has decided to keep it';
}

/**
 * Everything the infamy ledger needs to know about a raided district, and nothing more.
 *
 * It used to feed the §D8 stance tally as well. That is gone with reputation, and this is the one
 * place the map is read for either: the ledger never has to know what a district is.
 */
export interface RaidTarget {
  faction: Faction;
  isSeatOfPower: boolean;
}

export function raidTargetOf(district: District): RaidTarget {
  return { faction: district.faction, isSeatOfPower: isSeatOfGovernmentPower(district) };
}

/**
 * Whether a crew may raid this district's *base* (§A4).
 *
 * A home district is somebody's base and can never be captured, but it can be robbed, so long as
 * it is not your own. Contested ground is not raided at all: it is taken a location at a time, which
 * is `isLocationAttackable`'s question rather than this one.
 */
export function isDistrictRaidable(district: District, isOwnDistrict: boolean): boolean {
  return district.kind === 'residential' && !isOwnDistrict;
}

/** What holding the whole of `districtId` is worth, or `null` for ground with nothing to hold. */
export function unifiedBonusFor(districtId: string): UnifiedBonus | null {
  return UNIFIED_BONUSES[districtId] ?? null;
}

/** Which faction nominally garrisons a district's locations before anybody takes them. */
export function defaultHolderFaction(district: District): Faction {
  return district.faction;
}

/**
 * Guards at module load that the authored content is complete and self-consistent: cheaper to
 * trip here than to discover from a `undefined` on a map tooltip.
 */
for (const district of CITY_DISTRICTS) {
  const contested = district.kind === 'contested';
  if (contested && district.locations.length === 0) {
    throw new Error(`${district.id} is contested but has nothing in it to take`);
  }
  if (!contested && district.locations.length > 0) {
    throw new Error(`${district.id} is residential and cannot hold capturable locations`);
  }
  if (contested && !UNIFIED_BONUSES[district.id]) {
    throw new Error(`${district.id} is contested but has no unified bonus`);
  }
  for (const location of district.locations) {
    if (location.districtId !== district.id) {
      throw new Error(`${location.id} claims to be in ${location.districtId}`);
    }
  }
}

if (new Set(CITY_LOCATIONS.map((location) => location.id)).size !== CITY_LOCATIONS.length) {
  throw new Error('two locations share an id');
}
