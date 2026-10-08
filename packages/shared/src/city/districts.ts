import { z } from 'zod';
import { DEFAULT_CITY_ID } from './cities.js';
import { AllegianceSchema, governmentGarrisonFor, type Allegiance } from '../allegiance.js';
import { IdSchema } from './../primitives.js';
import { LocationSchema, type HoldBonus, type Location, type LocationKind } from './locations.js';

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

/**
 * What every district carries, whichever kind it is. The kind and anything that belongs to one kind
 * only are added by the two schemas below.
 */
const DistrictFields = {
  id: IdSchema,
  /**
   * Which city this ground is in.
   *
   * Defaulted rather than required, because every district authored below predates the second city
   * and all of them are Ashfall's. `city/atlas.ts` is where the others are, and it fills this in.
   * The field is on the district rather than on the crew for the reason the module note gives: a
   * crew is in a district and a district is in a city, and storing the city twice is how the two
   * copies come to disagree.
   */
  cityId: z.string().min(1).default(DEFAULT_CITY_ID),
  name: z.string().min(1),
  /**
   * What the street calls it: "the Tech District", "the Old City Center". Not every district has
   * one, and the ones that do not are more interesting for it: a nickname is something a location
   * earns.
   */
  nickname: z.string().min(1).nullable(),
  /**
   * What an abbreviated `name` stands for, spelled out.
   *
   * Only for the districts whose real name is initials. The map draws `name` because a tag on a
   * painting has room for three letters and not for three words, and the district screen draws
   * this, because that is the screen with room to say what the letters mean. Null everywhere else,
   * which is almost everywhere: a formal name that merely repeats `name` is noise on both screens.
   *
   * Deliberately not `nickname`. That field is what the street calls a place, and this is the
   * opposite of that: it is what the Combine calls it on the paperwork.
   */
  formalName: z.string().min(1).nullable().default(null),
  /** Whose ground this nominally is (§A3), before anybody starts taking it off them. */
  allegiance: AllegianceSchema,
  /** A seat of the Combine's power rather than one of its holdings: see §D8's `Revolutionary`. */
  seatOfPower: z.boolean(),
  position: PositionSchema,
  blurb: z.string().min(1),
  // The one location schema rather than a copy of its fields: `z.object` strips what it was not
  // told about, so a copy that lagged behind `LocationSchema` by one field would have dropped that
  // field from every district the client parses, and nothing would have said so.
  locations: z.array(LocationSchema),
};

/**
 * A plot a crew lives on. No difficulty (maintainer, 2026-09-30): nothing is fought for on a plot
 * but the crew's own gate, and what stands behind that gate is whatever the crew built, so a
 * number authored against the plot promised a fight the plot could never deliver.
 */
export const ResidentialDistrictSchema = z.object({
  ...DistrictFields,
  kind: z.literal('residential'),
});
export type ResidentialDistrict = z.infer<typeof ResidentialDistrictSchema>;

/**
 * Ground with locations on it. `difficulty` sizes the Combine's and the looters' garrisons, their
 * musters and spy counters, and the premium the district's mission board pays. The server reads it
 * and no screen prints it (maintainer, 2026-09-30): a player learns how hard ground is by spying
 * on it or by fighting on it.
 */
export const ContestedDistrictSchema = z.object({
  ...DistrictFields,
  kind: z.literal('contested'),
  difficulty: z.number().int().min(1).max(10),
});
export type ContestedDistrict = z.infer<typeof ContestedDistrictSchema>;

/**
 * Split on `kind` so a residential difficulty cannot be written or read: every caller that wants
 * the number has to have narrowed to contested ground first, and the compiler holds that.
 */
export const DistrictSchema = z.discriminatedUnion('kind', [
  ResidentialDistrictSchema,
  ContestedDistrictSchema,
]);
export type District = z.infer<typeof DistrictSchema>;

/** Contested ground, as a type guard for the `filter` calls that walk a mixed list. */
export function isContested(district: District): district is ContestedDistrict {
  return district.kind === 'contested';
}

/**
 * What a residential district is called when nobody lives there.
 *
 * Every one of them shares it, and that is the point: these are *plots*, not places with
 * histories. A crew moving in is what gives one a name, and the name it gets is the crew's own
 * (see {@link districtDisplayName}). The Docks were the last of them to carry an authored name and
 * that name went with them when they became ground worth fighting over.
 */
export const UNCLAIMED_DISTRICT_NAME = 'Unclaimed Player District';

/**
 * What to call a district on a screen.
 *
 * One function because it is one rule, and every screen that names a district has to say the same
 * thing. Contested ground always answers with its authored name. Residential ground answers with
 * **the name of the crew living there**, yours or anybody's, and with
 * {@link UNCLAIMED_DISTRICT_NAME} while nobody does (maintainer, 2026-10-06). The other plots were
 * numbered I, II, III until then, to keep a stranger's crew name off the map; the ruling is that a
 * claimed plot is simply that crew's.
 *
 * Nothing is stored. Rename the crew and the map says so on the next read, which is what makes the
 * tag a fact about the world rather than a copy of one. `ownDistrictId` and `ownName` name your
 * own plot off the live base, so a caller that has no resident read for it still gets it right;
 * `residentName` names everybody else's off the city read.
 */
export function districtDisplayName(
  district: District,
  viewer: {
    ownDistrictId?: string | null;
    ownName?: string | null;
    residentName?: string | null;
  } = {},
): string {
  if (district.kind !== 'residential') return district.name;
  const own =
    viewer.ownDistrictId !== undefined &&
    viewer.ownDistrictId !== null &&
    district.id === viewer.ownDistrictId;
  const name = own ? (viewer.ownName ?? viewer.residentName) : viewer.residentName;
  return name !== undefined && name !== null && name.length > 0 ? name : district.name;
}

/**
 * A crew name reduced to what a reader can actually tell apart.
 *
 * Case, surrounding space **and runs of space inside the name** all collapse. The inner run is the
 * one that is easy to miss and the one that actually bit: HTML collapses consecutive whitespace
 * when it lays text out, so `The  Ninth  Street  Crew` and `The Ninth Street Crew` paint the same
 * pixels on the same tag while comparing as two different strings. A rule that only trimmed the
 * ends let the second crew through and put two identical tags on the map.
 */
/**
 * Characters that take up no space on a painted tag.
 *
 * The zero-width set (U+200B..U+200D, U+FEFF) plus the bidi controls (U+200E, U+200F, U+202A..
 * U+202E, U+2066..U+2069) and the soft hyphen. None of them has a glyph, so `N<U+200B>inth Street`
 * and `Ninth Street` paint the same pixels while comparing as two different strings, which is the
 * same failure the inner-whitespace collapse above exists to stop, arriving through a character
 * `\s` does not match. The bidi ones also reorder everything after them, which is a layout bug on
 * every screen the name appears on.
 */
const INVISIBLE_CHARACTERS = /[\u00ad\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

function districtNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTERS, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/**
 * Whether a name is made only of characters a reader can see and lay out.
 *
 * Applied at the schema rather than in the key, because the two questions are different: the key
 * decides whether two names are the *same*, and this decides whether a name is one a screen can
 * draw at all. A control character, a newline in the middle of a plaque or a right-to-left override
 * is not a name somebody chose to be told apart by.
 */
export function isPaintableDistrictName(name: string): boolean {
  if (INVISIBLE_CHARACTERS.test(name)) {
    INVISIBLE_CHARACTERS.lastIndex = 0;
    return false;
  }
  INVISIBLE_CHARACTERS.lastIndex = 0;
  // C0 and C1 controls, which includes the newline and the NUL. Read off the code point rather than
  // written as a character class: a regex literal holding raw control characters is exactly what
  // `no-control-regex` is for, and this reads as what it means anyway.
  for (const character of name) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) return false;
  }
  return true;
}

/**
 * Whether two crew names are the same name, for the purpose of telling them apart in a city.
 *
 * Case and space are not a difference anybody can see on a painted tag, so `eterosegw`,
 * `EterosEgw`, `  EterosEgw ` and `Eteros  Egw` are one name here. Two crews in the same city
 * sharing one is not a cosmetic problem: the map, every battle report and every trade listing name
 * a crew by that string and nothing else, so a duplicate makes two different people
 * indistinguishable everywhere they appear.
 */
export function sameDistrictName(a: string, b: string): boolean {
  return districtNameKey(a) === districtNameKey(b);
}

/**
 * Whether a crew may call itself this, ignoring who else is in the city.
 *
 * The empty plot's name is reserved. A crew called `Unclaimed Player District` would be
 * indistinguishable from the plot the map draws under that name, which is the same confusion
 * `sameDistrictName` exists to prevent, arriving from the other direction.
 */
export function isReservedDistrictName(name: string): boolean {
  return districtNameKey(name) === districtNameKey(UNCLAIMED_DISTRICT_NAME);
}

/**
 * District new crews are settled into.
 *
 * The Docks used to be it, and stopped being it when they were opened up as contested ground: a
 * starter home has to be somewhere nobody can take, and the Docks are now the first thing a new
 * crew is expected to go and take. Migration `0040` rehouses the crews who were already living
 * there.
 *
 * Which plot is not arbitrary. `city.test.ts` asks that the Spire be half again as far from home as
 * downtown is, so a starter sitting level with Chrome Row fails it: from the Terraces the two are
 * 46 and 48 minutes, which is not a city with a far side. From the Row, low and left, they are 18
 * and 61.
 */
export const STARTER_DISTRICT_ID = 'kettle-row';

/**
 * District held by the seeded AI rival. Never the starter, or the rival is the player's landlord.
 *
 * The Terraces used to be it and are now where migration `0040` rehoused the crews who were living
 * in the Docks, so the rival moved to one of the two plots opened at the same time.
 */
export const BOT_DISTRICT_ID = 'upper-roofs';

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
 * completing rather than worth farming the best location in: the Belt is full of scrap, and
 * finishing them buys cheaper troops instead of yet more scrap. `city.test.ts` enforces that:
 * a unified bonus whose effect kind already appears inside its own district fails the suite.
 */
export const UNIFIED_BONUSES: Readonly<Record<string, UnifiedBonus>> = {
  'neon-docks': {
    title: 'The Whole Waterfront',
    /*
     * Everything in this city that was not made here came over this quay, and a crew that holds
     * all of it is buying at the price the boat charged rather than the price the street does.
     *
     * Deliberately not another resource line: the Docks already pay caps at the Tideline and
     * supplies at the Pumphouse and the Galley, and a unified bonus that paid a third of the same
     * would make finishing the district indistinguishable from farming its best hold.
     */
    bonus: { kind: 'market_discount', percent: 12 },
  },
  steelbelt: {
    title: 'Run of the Belt',
    // Cut from 10 with every general muster cut (maintainer, 2026-10-01).
    bonus: { kind: 'muster_cost', percent: 2 },
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
  annexes: {
    title: 'The Faculty Answers To You',
    bonus: { kind: 'unit_stealth', percent: 20 },
  },
  'glasshouse-fields': {
    title: 'The Green Belt Is Fed',
    bonus: { kind: 'muster_speed', percent: 15 },
  },
  blacksite: {
    title: 'The Garrison Is Yours',
    bonus: { kind: 'unit_offense', percent: 15 },
  },
  ccs: {
    title: 'The Spire Is Taken',
    // The last district in Ashfall pays what every city's last district pays (maintainer,
    // 2026-10-07): a level of ANTI-COMBINE, +10% damage and vitality against the Combine,
    // stacking with the Blockhouse's and the Nave's to +30%. It replaced twenty points off every
    // market in every city.
    bonus: { kind: 'anti_combine' },
  },
};

/**
 * One district, with the boring fields filled in.
 *
 * The atlas authors fourteen districts, and typing `formalName: null, seatOfPower: false` on every
 * one of them is fourteen chances to get a default wrong. The literals below predate this and are
 * left exactly as they were: they are the map everybody has learned, and rewriting them through a
 * helper would be a large diff for no change in behaviour.
 */
export function districtFrom(
  spec: {
    id: string;
    cityId: string;
    name?: string | undefined;
    nickname: string | null;
    allegiance: District['allegiance'];
    seatOfPower?: boolean;
    position: District['position'];
    blurb: string;
    locations: readonly LocationRow[];
  } & ({ kind: 'residential' } | { kind: 'contested'; difficulty: number }),
): District {
  const common = {
    id: spec.id,
    cityId: spec.cityId,
    // A plot has no authored name: it is ground a crew moves into and takes the name of.
    name: spec.name ?? UNCLAIMED_DISTRICT_NAME,
    nickname: spec.nickname,
    formalName: null,
    allegiance: spec.allegiance,
    seatOfPower: spec.seatOfPower ?? false,
    position: spec.position,
    blurb: spec.blurb,
    locations: locationsIn(spec.id, spec.locations),
  };
  return spec.kind === 'contested'
    ? { ...common, kind: 'contested', difficulty: spec.difficulty }
    : { ...common, kind: 'residential' };
}

/**
 * One authored location, as a row: slug, name, kind, and optionally what this particular place
 * is. The fourth element is what lets two rail yards read differently (`LocationSchema.blurb`); a
 * row without one prints its kind's line.
 */
type LocationRow = readonly [
  slug: string,
  name: string,
  kind: LocationKind,
  blurb?: string,
  /** What this place pays instead of its kind's list (`LocationSchema.bonuses`). */
  bonuses?: readonly HoldBonus[],
];

/** Terser than repeating the district id in every location literal. */
function locationsIn(districtId: string, rows: readonly LocationRow[]): Location[] {
  return rows.map(([slug, name, kind, blurb, bonuses]) => ({
    id: `${districtId}-${slug}`,
    districtId,
    name,
    kind,
    ...(blurb === undefined ? {} : { blurb }),
    ...(bonuses === undefined ? {} : { bonuses }),
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
 * Steelbelt, the three cheapest locations in the game, and the Combine is at the top, with the
 * Combine Spire looking down the middle of the frame from the highest point on it. Difficulty rises
 * with height almost monotonically, so "further up" and "harder" are the same direction, and a
 * player who has taken the low ground can see what the next rung is without opening anything.
 *
 * Allegiance reads left-to-right within that: independent ground on the flanks, the Combine's
 * holdings up the centre and the right, which is why the Blacksite and the Annexes bracket the
 * approach to the Spire. `city.test.ts` pins the gradient and the spacing so a future district
 * cannot be dropped in on top of another one.
 */
/*
 * Authored without `cityId` and stamped with it below.
 *
 * Every one of these is Ashfall's, and writing `cityId: 'ashfall'` on twelve literals would be
 * twelve copies of one fact. The stamp is where the second city arrives from: `city/atlas.ts`
 * authors its districts with their own id and this array keeps the default.
 */
/** `Omit` over each member of the union rather than over the keys they share. */
type WithoutCity<T> = T extends District ? Omit<T, 'cityId'> : never;

const ASHFALL: readonly WithoutCity<District>[] = [
  /*
   * **Order is the art seed.** `art/manifest.ts` seeds `district-*` off each entry's index here, so
   * moving one renumbers the seed of every district after it and silently re-rolls art that may
   * already have been made. The list is therefore in the order it was first authored, and the two
   * districts added later are appended at the end rather than filed with their own kind. Read the
   * map by `kind`, never by position.
   */
  {
    /*
     * The Docks, opened up.
     *
     * They were the starter home and they are the starter *target* now: difficulty 1, seven easy
     * holds, and close enough to everywhere that a crew's first campaign is a real one rather than
     * a walk. A waterfront the Combine stopped patrolling is exactly the ground a new crew should
     * be able to take off the people squatting it, and a district with nothing in it was the one
     * piece of the map that could never be played.
     */
    id: 'neon-docks',
    name: 'Neon Docks',
    nickname: 'the Docks',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: false,
    position: { x: 0.15, y: 0.9 },
    difficulty: 1,
    blurb:
      'Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.',
    locations: locationsIn('neon-docks', [
      ['tideline', 'The Tideline Market', 'market'],
      ['pumphouse', 'Dockside Pumphouse', 'water_works'],
      // Under the quay and out past the boom: the reason anything the Combine bans is cheap here.
      ['runners', "Runners' Tunnel", 'smugglers_tunnel'],
      ['galley', 'The Wet Galley', 'soup_kitchen'],
      // People have been living on the moored barges longer than anybody has been calling it a slum.
      ['barges', 'The Moored Barges', 'refugee_camp'],
      // A gantry crane with a cabin at the top of it. Whoever is up there sees the whole waterfront.
      // Named a Site rather than a Gate (maintainer request): a district's *gate* is a real mechanic
      // three files over, and a location whose name claimed to be one had players calling fights
      // at it expecting the district to open.
      ['cranegate', 'Crane Site', 'watchtower'],
      ['chandler', 'The Chandlery', 'pawn_shop'],
    ]),
  },
  {
    id: 'ashen-terraces',
    name: UNCLAIMED_DISTRICT_NAME,
    nickname: null,
    formalName: null,
    kind: 'residential',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.84, y: 0.62 },
    blurb:
      'Stepped tenements up the northern slope, burnt once and rebuilt out of what was left. Whoever holds it can see the whole city coming.',
    locations: [],
  },
  {
    id: 'kettle-row',
    name: UNCLAIMED_DISTRICT_NAME,
    nickname: null,
    formalName: null,
    kind: 'residential',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.38, y: 0.82 },
    blurb:
      'A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.',
    locations: [],
  },

  {
    id: 'steelbelt',
    /*
     * The Steelbelt, and it used to be the Rustyard.
     *
     * A field of sorted wreckage became a belt of works that are still *running*: presses on shift,
     * furnaces lit, a pump row that sells to the hauliers. Same seven locations and the same seven
     * kinds, because a kind is a mechanical fact rather than a name: `doghouse` here is the only
     * one in the city and it is what unlocks the Cyberhounds, so renaming the ground could not be
     * allowed to move it. The **id** is unchanged for the same class of reason one level down:
     * every location id and every saved control row is keyed on it.
     */
    name: 'Steelbelt',
    nickname: 'the Belt',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: false,
    position: { x: 0.63, y: 0.83 },
    difficulty: 2,
    blurb:
      'Rolling mills, press houses and a furnace row that has not gone cold in thirty years. The Combine holds every works on the Belt and keeps the gate shut behind them, and the crews who work it clock in under Greycoat guns.',
    locations: locationsIn('steelbelt', [
      ['press', 'No. 4 Press House', 'scrap_press'],
      ['bonefield', "The Breaker's Yard", 'war_machine_graveyard'],
      ['pawn', 'Toolhouse Pawn', 'pawn_shop'],
      // A drained slag pit the shift kids ride. Industrial ground put to a use nobody planned.
      ['ramp', 'The Slag Bowl', 'skate_ground'],
      ['pumps', 'Furnace Row Pumps', 'gas_station'],
      // Named, not renamed: the *kind* is the only `doghouse` in the city and it is what puts
      // Cyberhounds on the roster. See `units/catalog.ts`.
      ['kennels', 'The Doghouse', 'doghouse'],
      // The Bone Market went to Arca's Gravefields (maintainer, 2026-10-06), and the works
      // got a canteen: the shift has to eat somewhere.
      ['canteen', 'The Shift Canteen', 'soup_kitchen'],
    ]),
  },
  {
    id: 'chrome-row',
    name: 'Chrome Row',
    nickname: 'the Old City Center',
    formalName: null,
    kind: 'contested',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.3, y: 0.62 },
    difficulty: 4,
    blurb:
      'What is left of downtown: bank halls turned into markets, a picture house that never closed, and a transmitter mast nobody has managed to hold for a whole season.',
    locations: locationsIn('chrome-row', [
      ['exchange', 'The Exchange', 'downtown_market'],
      ['cathode', 'Cathode Tower', 'broadcast_tower'],
      ['overlook', 'The Overlook', 'high_ground'],
      ['ferrous', 'Saint Ferrous', 'hospital'],
      ['statue', 'Statue of the Revolutionary', 'revolutionary_statue'],
      ['regal', 'The Regal', 'cinema'],
      ['anvil', 'The Cracked Anvil', 'tavern'],
      ['coinop', 'Coin-Op Row', 'arcade'],
    ]),
  },
  {
    id: 'undergrid',
    name: 'The Undergrid',
    nickname: 'the Power Spine',
    formalName: null,
    kind: 'contested',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.55, y: 0.58 },
    difficulty: 5,
    blurb:
      'The Combine meters the whole undercity from down here. Bundled conduit running the walls like roots, transformer housings the size of buildings, and older tunnels underneath that are on nobody’s drawings.',
    locations: locationsIn('undergrid', [
      ['substation', 'Undergrid Substation', 'power_station'],
      ['vault9', 'Transformer Vault 9', 'power_station'],
      ['junction', 'The Weeping Junction', 'sewer_junction'],
      ['reagent', 'Reagent Works', 'chemical_plant'],
      ['customs', 'The Old Customs Run', 'smugglers_tunnel'],
      ['depot', 'Lamplight Depot', 'tram_depot'],
      ['lair', 'The Laundry Stair', 'mad_scientist_lair'],
    ]),
  },
  {
    id: 'annexes',
    name: 'The Annexes',
    nickname: 'the Tech District',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: false,
    position: { x: 0.76, y: 0.38 },
    difficulty: 6,
    blurb:
      'Faculty buildings the Combine never closed, because it was easier to move in. Everything worth knowing in this city is written down somewhere in here.',
    locations: locationsIn('annexes', [
      ['faculty', 'The Faculty Annexe', 'university'],
      ['uplink', 'Annexe Uplink', 'satellite_uplink'],
      ['ward', 'The Quiet Ward', 'gene_clinic'],
      ['coldrow', 'Cold Row', 'foundry'],
      ['orrery', 'The Orrery', 'planetarium'],
      ['loft', 'Nine Roofs', 'pirate_radio'],
      // The half-built faculty tower. Also the only crane in the city outside the Spire: see the
      // note on the Colossus in `units/catalog.ts` for why that matters.
      ['scaffold', 'The Unfinished Faculty', 'construction_site'],
    ]),
  },
  {
    id: 'glasshouse-fields',
    name: 'Glasshouse Fields',
    nickname: 'the Green Belt',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: false,
    position: { x: 0.1, y: 0.58 },
    difficulty: 3,
    blurb:
      'State hydroponics behind a fence. Everything the undercity eats is grown here, and none of it is sold here.',
    locations: locationsIn('glasshouse-fields', [
      ['intake', 'Glasshouse Intake', 'water_works'],
      ['fieldgate', 'Fieldgate Market', 'market'],
      ['berm', 'The Berm', 'high_ground'],
      ['haulers', 'Hauler Yard', 'rail_yard'],
      ['ladle', 'The Long Ladle', 'soup_kitchen'],
      ['fieldchapel', 'Chapel of the Furrow', 'chapel'],
      // Against the fence, on the wrong side of the food.
      ['fence', 'The Fence Camp', 'refugee_camp'],
      // The glass itself, along the top of the painting (maintainer request, 2026-09-15). The
      // district was named for these and had no location standing on them.
      [
        'glasshouses',
        'The Glasshouses',
        'glasshouse',
        'The row of glass houses along the top of the fields, lamps lit inside and windmills pumping the beds. Everything under that glass is on a Combine manifest before it is picked.',
      ],
    ]),
  },
  {
    id: 'blacksite',
    name: 'Blacksite',
    nickname: 'the Military District',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.33, y: 0.3 },
    difficulty: 8,
    blurb:
      'Hardened ferrocrete, layered berms, and a Combine rifle company that has never had to leave. The first place anyone learns not to walk into.',
    /*
     * Every location here carries its own blurb, written to where it stands in the delivered
     * painting (`art-src/plate-district-blacksite.png`, 2026-09-15), so the sheet describes the
     * thing the sign is hung on rather than the kind in general. Three were renamed the same day:
     * Motor Pool Seven, Ward Nine and Pit Seventeen lost their numbers. The slugs stayed, because
     * every saved control row is keyed on them; `pit17` now reads as a number the place no longer
     * has, and is left that way on purpose.
     */
    locations: locationsIn('blacksite', [
      [
        'armory',
        'Blacksite Armory',
        'armory',
        'The hardened bunker at the centre of the yard, under the tower, racks lit orange inside. Everything the rifle company carries when it goes out came off those racks.',
      ],
      [
        'outer',
        'Outer Berm',
        'barricade',
        'The fortified compound at the top of the hill, its great gate under the red-diamond banners, and the ramparts running down from it along the whole left of the yard. The only way in is under those banners.',
      ],
      [
        'watchtower',
        'The Watchtower',
        'watchtower',
        'The tower left of centre with the searchlight on top. Whoever is up there sees the whole yard lit at once, and most of the city past it.',
      ],
      [
        'pit17',
        'Robot Pit',
        'fight_pit',
        'The lit ring at the bottom left of the yard. Machines are set against each other in it, and against men when the crowd wants that instead; the bookmaker takes both.',
      ],
      [
        'motorpool',
        'Motor Pool',
        'war_machine_graveyard',
        'Trucks and tracked vehicles drawn up below the armoury, right of centre. Half of it runs, the other half is spares, and the gantry does not care which.',
      ],
      [
        'drill',
        'The Drill Hall',
        'gym',
        'The bunker at the top right, with the rifle company drawn up in ranks on the square in front of it. Drill every morning, iron every evening, nobody excused.',
      ],
      [
        'blackward',
        'Psychic Ward',
        'black_clinic',
        'The cyan-lit room set into the high wall on the right, glass on the yard side. The Combine takes minds apart in there and puts them back the way it wants them; what walks out remembers the wall and very little else.',
      ],
      [
        'pile',
        'The Pile',
        'nuclear_plant',
        'Reactor drums and a cooling tower in the far bottom-right corner, steaming. The Combine never shut it down; it only stopped saying what it was for.',
      ],
    ]),
  },
  {
    id: 'ccs',
    name: 'CCS',
    formalName: 'Civic Command Sector',
    nickname: 'the Spire',
    kind: 'contested',
    allegiance: 'government',
    seatOfPower: true,
    position: { x: 0.57, y: 0.13 },
    difficulty: 10,
    blurb:
      'The surface spire the government rules from, and the household guard that has never been tested. Taking this is not a raid. It is the end of something.',
    locations: locationsIn('ccs', [
      ['uplink', 'Command Uplink', 'satellite_uplink'],
      ['armory', 'Combine Armory', 'armory'],
      ['household', 'The Household Barricade', 'barricade'],
      ['broadcast', 'Command Broadcast', 'broadcast_station'],
      ['ascension', 'The Ascension Clinic', 'gene_clinic'],
      ['scaffold', 'The Unfinished Wing', 'construction_site'],
      ['martyrs', 'The Martyrs’ Ground', 'graveyard'],
      ['chapel', 'The Chosen Chapel', 'combine_chapel'],
    ]),
  },
  {
    // The roofs above the slab wall, north-west of frame: high ground with the wall between it and
    // everything the Combine cares about, which is why anybody was allowed to build there.
    id: 'upper-roofs',
    name: UNCLAIMED_DISTRICT_NAME,
    nickname: null,
    formalName: null,
    kind: 'residential',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.91, y: 0.79 },
    blurb:
      'Roofs stacked on roofs above the wall, reached by ladders somebody bolted on in the dark. Nothing official has been up here in years and the view is the whole northern approach.',
    locations: [],
  },
  {
    // Down at the far end of the market, where the awnings stop and the water starts again.
    id: 'south-quay',
    name: UNCLAIMED_DISTRICT_NAME,
    nickname: null,
    formalName: null,
    kind: 'residential',
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.78, y: 0.93 },
    blurb:
      'The tail of the market where the stalls give out and the cut comes back up to meet the street. Damp, cheap, and out of everybody else\u2019s way.',
    locations: [],
  },
];

export const CITY_DISTRICTS: readonly District[] = ASHFALL.map((district) => ({
  ...district,
  cityId: DEFAULT_CITY_ID,
}));

export function findAshfallDistrict(districtId: string): District | undefined {
  return CITY_DISTRICTS.find((district) => district.id === districtId);
}

/**
 * Which city a district is in, or `undefined` for a district nothing authored.
 *
 * Every district is in Ashfall today, so the map is built by assigning them all the one id. That is
 * the honest shape rather than a hardcoded return: the *edge* from district to city exists, and
 * when the board adds a second city only the values here change. Every screen asking "is this near
 * me" already goes through this.
 */
/* `cityOf` lives in `city/atlas.ts` now: it has to answer for every city, and this module can
 * only see Ashfall's. Re-exported from the barrel, so nothing that imports it had to move. */

/** Every authored location in the city, flattened. */
export const CITY_LOCATIONS: readonly Location[] = CITY_DISTRICTS.flatMap(
  (district) => district.locations,
);

export function findAshfallLocation(locationId: string): Location | undefined {
  return CITY_LOCATIONS.find((location) => location.id === locationId);
}

/** Districts a crew can settle in. Contested ground holds locations, not homes. */
export const RESIDENTIAL_DISTRICTS: readonly District[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'residential',
);

/** Districts with something in them to take. */
export const CONTESTED_DISTRICTS: readonly ContestedDistrict[] = CITY_DISTRICTS.filter(isContested);

/**
 * A seat of the government's power rather than one of its holdings (§A3): what you have to take
 * to be *replacing* the Combine instead of merely robbing it. That is the whole difference between
 * §D8's `Anti-systemic` and `Revolutionary`.
 */
export function isSeatOfGovernmentPower(district: District): boolean {
  return district.allegiance === 'government' && district.seatOfPower;
}

/**
 * The garrison the Combine stands on its own ground when the strike team arrives (§A3), or null
 * anywhere else.
 *
 * Only the Combine's ground has an authored answer. Open ground used to answer "whoever holds the
 * ground and has decided to keep it", which told a player nothing the holder plates did not, and
 * the maintainer took it out on 2026-09-30: the Garrison row counts who holds what instead
 * (`districtHoldLine` on the client).
 */
export function garrisonOf(district: ContestedDistrict): string | null {
  return district.allegiance === 'government' ? governmentGarrisonFor(district.difficulty) : null;
}

/**
 * Everything the infamy ledger needs to know about a raided district, and nothing more.
 *
 * It used to feed the §D8 stance tally as well. That is gone with reputation, and this is the one
 * place the map is read for either: the ledger never has to know what a district is.
 */
export interface RaidTarget {
  allegiance: Allegiance;
  isSeatOfPower: boolean;
}

export function raidTargetOf(district: District): RaidTarget {
  return { allegiance: district.allegiance, isSeatOfPower: isSeatOfGovernmentPower(district) };
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

/*
 * `unifiedBonusFor` used to live here and read `UNIFIED_BONUSES` alone, which was Ashfall's table.
 * It is in `atlas.ts` now, over every city's, because a Terminus district finished whole has to
 * pay the same way an Ashfall one does. This module cannot answer that: it cannot see the atlas
 * without importing the module that imports it.
 */

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
