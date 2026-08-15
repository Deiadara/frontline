import { z } from 'zod';
import type { RaidTarget } from '../economy/reputation.js';
import { FactionSchema, governmentGarrisonFor, type Faction } from '../factions.js';
import { IdSchema } from './../primitives.js';
import {
  FortifyDifficultySchema,
  PlaceKindSchema,
  type HoldBonus,
  type Place,
  type PlaceKind,
} from './places.js';

/**
 * The city (GDD §A4) — ten districts, hard-authored, with the places inside them.
 *
 * Two kinds of ground, and the difference is the whole shape of the game:
 *
 *   * **Residential** districts hold crews. A crew's own district is its base — the thirteen
 *     structures of §A1 — and it can be *raided* but never taken. Losing everything you have built
 *     because you were asleep is not a strategy game, it is a punishment.
 *   * **Contested** districts hold **places**: a substation, a pawn shop, a war machine graveyard.
 *     Each is held by somebody, each is takeable on its own, and each pays for as long as you keep
 *     it. Take every place in a district and the district is yours, which pays again.
 *
 * Nothing here is generated. A map is only worth learning if it is the same map tomorrow.
 */

export const DISTRICT_KINDS = ['residential', 'contested'] as const;
export const DistrictKindSchema = z.enum(DISTRICT_KINDS);
export type DistrictKind = z.infer<typeof DistrictKindSchema>;

/** Normalized 0..1 map coordinates — the renderer scales to its viewport. */
export const PositionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type Position = z.infer<typeof PositionSchema>;

export const DistrictSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /**
   * What the street calls it — "the Tech District", "the Old City Center". Not every district has
   * one, and the ones that do not are more interesting for it: a nickname is something a place
   * earns.
   */
  nickname: z.string().min(1).nullable(),
  kind: DistrictKindSchema,
  /** Whose ground this nominally is (§A3), before anybody starts taking it off them. */
  faction: FactionSchema,
  /** A seat of the Combine's power rather than one of its holdings — see §D8's `Revolutionary`. */
  seatOfPower: z.boolean(),
  position: PositionSchema,
  difficulty: z.number().int().min(1).max(10),
  blurb: z.string().min(1),
  places: z.array(
    z.object({
      id: z.string().min(1),
      districtId: z.string().min(1),
      name: z.string().min(1),
      kind: PlaceKindSchema,
      fortifyDifficulty: FortifyDifficultySchema,
    }),
  ),
});
export type District = z.infer<typeof DistrictSchema>;

/** District new crews are settled into. */
export const STARTER_DISTRICT_ID = 'neon-docks';

/** District held by the seeded AI rival. */
export const BOT_DISTRICT_ID = 'ashen-terraces';

/** What holding every place in a district is worth on top of the places themselves. */
export interface UnifiedBonus {
  /** Named, because "you have taken the whole district" deserves to be said out loud. */
  title: string;
  bonus: HoldBonus;
}

/**
 * The §A4 unified bonus per contested district.
 *
 * Each is deliberately something *other* than what its own places give, so a district is worth
 * completing rather than worth farming the best place in — the Scrapfields are full of scrap, and
 * finishing them buys cheaper troops instead of yet more scrap. `city.test.ts` enforces that:
 * a unified bonus whose effect kind already appears inside its own district fails the suite.
 */
export const UNIFIED_BONUSES: Readonly<Record<string, UnifiedBonus>> = {
  rustyard: {
    title: 'Run of the Scrapfields',
    bonus: { kind: 'training_cost', percent: 10 },
  },
  'chrome-row': {
    title: 'The Row Pays Its Dues',
    bonus: { kind: 'unit_morale', flat: 10 },
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
    bonus: { kind: 'resource', resource: 'caps', perHour: 120 },
  },
};

/** Terser than repeating the district id in every place literal. */
function placesIn(
  districtId: string,
  rows: readonly [
    slug: string,
    name: string,
    kind: PlaceKind,
    fortify: Place['fortifyDifficulty'],
  ][],
): Place[] {
  return rows.map(([slug, name, kind, fortifyDifficulty]) => ({
    id: `${districtId}-${slug}`,
    districtId,
    name,
    kind,
    fortifyDifficulty,
  }));
}

export const CITY_DISTRICTS: readonly District[] = [
  // --- residential: crews live here, and nobody takes these ---
  {
    id: 'neon-docks',
    name: 'Neon Docks',
    nickname: 'the Docks',
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.12, y: 0.72 },
    difficulty: 1,
    blurb:
      'Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.',
    places: [],
  },
  {
    id: 'ashen-terraces',
    name: 'Ashen Terraces',
    nickname: null,
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.85, y: 0.2 },
    difficulty: 4,
    blurb:
      'Stepped tenements up the northern slope, burnt once and rebuilt out of what was left. Whoever holds it can see the whole city coming.',
    places: [],
  },
  {
    id: 'kettle-row',
    name: 'Kettle Row',
    nickname: null,
    kind: 'residential',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.3, y: 0.92 },
    difficulty: 2,
    blurb:
      'A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.',
    places: [],
  },

  // --- contested: this is what there is to fight over ---
  {
    id: 'rustyard',
    name: 'The Rustyard',
    nickname: 'the Scrapfields',
    kind: 'contested',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.28, y: 0.55 },
    difficulty: 2,
    blurb:
      'Square kilometres of sorted wreckage, worked by whoever got there first. The looters here are disorganised, which is the only reason anybody starts a war on this ground.',
    places: placesIn('rustyard', [
      ['press', 'Kessler Press', 'scrap_press', 'easy'],
      ['bonefield', 'The Bonefield', 'war_machine_graveyard', 'hard'],
      ['pawn', 'Ninth Street Pawn', 'pawn_shop', 'easy'],
      ['ramp', 'The Ramp', 'skate_ground', 'easy'],
    ]),
  },
  {
    id: 'chrome-row',
    name: 'Chrome Row',
    nickname: 'the Old City Center',
    kind: 'contested',
    faction: 'independent',
    seatOfPower: false,
    position: { x: 0.45, y: 0.78 },
    difficulty: 4,
    blurb:
      'What is left of downtown: bank halls turned into markets, and a transmitter mast nobody has managed to hold for a whole season.',
    places: placesIn('chrome-row', [
      ['market', 'Chrome Row Market', 'market', 'medium'],
      ['cathode', 'Cathode Tower', 'broadcast_tower', 'hard'],
      ['overlook', 'The Overlook', 'high_ground', 'hard'],
      ['ferrous', 'Saint Ferrous', 'hospital', 'easy'],
      ['longpawn', 'The Long Pawn', 'pawn_shop', 'easy'],
    ]),
  },
  {
    id: 'undergrid',
    name: 'The Undergrid',
    nickname: 'the Power Spine',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.55, y: 0.42 },
    difficulty: 5,
    blurb:
      'The Combine meters the whole undercity from down here. Bundled conduit running the walls like roots, and transformer housings the size of buildings.',
    places: placesIn('undergrid', [
      ['substation', 'Undergrid Substation', 'power_station', 'hard'],
      ['vault9', 'Transformer Vault 9', 'power_station', 'hard'],
      ['junction', 'The Weeping Junction', 'sewer_junction', 'easy'],
      ['reagent', 'Reagent Works', 'chemical_plant', 'medium'],
    ]),
  },
  {
    id: 'datavault-sigma',
    name: 'Datavault Sigma',
    nickname: 'the Tech District',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.68, y: 0.65 },
    difficulty: 6,
    blurb:
      'Faculty buildings the Combine never closed, because it was easier to move in. Everything worth knowing in this city is written down somewhere in here.',
    places: placesIn('datavault-sigma', [
      ['faculty', 'Sigma Faculty', 'university', 'medium'],
      ['uplink', 'Uplink Sigma', 'satellite_uplink', 'hard'],
      ['ward', 'The Quiet Ward', 'gene_clinic', 'hard'],
      ['coldrow', 'Cold Row', 'foundry', 'medium'],
    ]),
  },
  {
    id: 'glasshouse-fields',
    name: 'Glasshouse Fields',
    nickname: 'the Green Belt',
    kind: 'contested',
    faction: 'government',
    seatOfPower: false,
    position: { x: 0.2, y: 0.28 },
    difficulty: 3,
    blurb:
      'State hydroponics behind a fence. Everything the undercity eats is grown here, and none of it is sold here.',
    places: placesIn('glasshouse-fields', [
      ['intake', 'Glasshouse Intake', 'water_works', 'medium'],
      ['fieldgate', 'Fieldgate Market', 'market', 'easy'],
      ['berm', 'The Berm', 'high_ground', 'easy'],
      ['haulers', 'Hauler Yard', 'rail_yard', 'medium'],
    ]),
  },
  {
    id: 'blacksite-7',
    name: 'Blacksite 7',
    nickname: 'the Military District',
    kind: 'contested',
    faction: 'government',
    seatOfPower: true,
    position: { x: 0.78, y: 0.38 },
    difficulty: 8,
    blurb:
      'Hardened ferrocrete, layered berms, and a Directorate rifle company that has never had to leave. The first place anyone learns not to walk into.',
    places: placesIn('blacksite-7', [
      ['armory', 'Blacksite Armory', 'armory', 'hard'],
      ['outer', 'Outer Berm', 'barricade', 'hard'],
      ['watchtower', 'The Watchtower', 'high_ground', 'hard'],
      ['pit17', 'Pit Seventeen', 'fight_pit', 'medium'],
      ['motorpool', 'Motor Pool Seven', 'war_machine_graveyard', 'hard'],
    ]),
  },
  {
    id: 'combine-spire',
    name: 'Spire of the Combine',
    nickname: 'the Spire',
    kind: 'contested',
    faction: 'government',
    seatOfPower: true,
    position: { x: 0.5, y: 0.08 },
    difficulty: 10,
    blurb:
      'The surface spire the government rules from, and the household guard that has never been tested. Taking this is not a raid. It is the end of something.',
    places: placesIn('combine-spire', [
      ['uplink', 'Spire Uplink', 'satellite_uplink', 'hard'],
      ['armory', 'Directorate Armory', 'armory', 'hard'],
      ['household', 'The Household Barricade', 'barricade', 'hard'],
      ['broadcast', 'Spire Broadcast', 'broadcast_tower', 'hard'],
      ['ascension', 'The Ascension Clinic', 'gene_clinic', 'hard'],
    ]),
  },
];

export function findDistrict(districtId: string): District | undefined {
  return CITY_DISTRICTS.find((district) => district.id === districtId);
}

/** Every authored place in the city, flattened. */
export const CITY_PLACES: readonly Place[] = CITY_DISTRICTS.flatMap((district) => district.places);

export function findPlace(placeId: string): Place | undefined {
  return CITY_PLACES.find((place) => place.id === placeId);
}

/** Districts a crew can settle in. Contested ground holds places, not homes. */
export const RESIDENTIAL_DISTRICTS: readonly District[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'residential',
);

/** Districts with something in them to take. */
export const CONTESTED_DISTRICTS: readonly District[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'contested',
);

/**
 * A seat of the government's power rather than one of its holdings (§A3) — what you have to take
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

/** Everything §D8's stance counters need to know about a raided district, and nothing more. */
export function raidTargetOf(district: District): RaidTarget {
  return { faction: district.faction, isSeatOfPower: isSeatOfGovernmentPower(district) };
}

/**
 * Whether a crew may raid this district's *base* (§A4).
 *
 * A home district is somebody's base and can never be captured — but it can be robbed, so long as
 * it is not your own. Contested ground is not raided at all: it is taken a place at a time, which
 * is `isPlaceAttackable`'s question rather than this one.
 */
export function isDistrictRaidable(district: District, isOwnDistrict: boolean): boolean {
  return district.kind === 'residential' && !isOwnDistrict;
}

/** What holding the whole of `districtId` is worth, or `null` for ground with nothing to hold. */
export function unifiedBonusFor(districtId: string): UnifiedBonus | null {
  return UNIFIED_BONUSES[districtId] ?? null;
}

/** Which faction nominally garrisons a district's places before anybody takes them. */
export function defaultHolderFaction(district: District): Faction {
  return district.faction;
}

/**
 * Guards at module load that the authored content is complete and self-consistent — cheaper to
 * trip here than to discover from a `undefined` on a map tooltip.
 */
for (const district of CITY_DISTRICTS) {
  const contested = district.kind === 'contested';
  if (contested && district.places.length === 0) {
    throw new Error(`${district.id} is contested but has nothing in it to take`);
  }
  if (!contested && district.places.length > 0) {
    throw new Error(`${district.id} is residential and cannot hold capturable places`);
  }
  if (contested && !UNIFIED_BONUSES[district.id]) {
    throw new Error(`${district.id} is contested but has no unified bonus`);
  }
  for (const place of district.places) {
    if (place.districtId !== district.id) {
      throw new Error(`${place.id} claims to be in ${place.districtId}`);
    }
  }
}

if (new Set(CITY_PLACES.map((place) => place.id)).size !== CITY_PLACES.length) {
  throw new Error('two places share an id');
}
