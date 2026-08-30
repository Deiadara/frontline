import { z } from 'zod';
import { AllegianceSchema, governmentGarrisonFor, type Allegiance } from '../allegiance.js';
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
  /**
   * What an abbreviated `name` stands for, spelled out.
   *
   * Only for the districts whose real name is initials. The map draws `name` because a tag on a
   * painting has room for three letters and not for three words, and the district screen draws
   * this, because that is the screen with room to say what the letters mean. Null everywhere else,
   * which is almost everywhere: a formal name that merely repeats `name` is noise on both screens.
   *
   * Deliberately not `nickname`. That field is what the street calls a place, and this is the
   * opposite of that: it is what the Directorate calls it on the paperwork.
   */
  formalName: z.string().min(1).nullable().default(null),
  kind: DistrictKindSchema,
  /** Whose ground this nominally is (§A3), before anybody starts taking it off them. */
  allegiance: AllegianceSchema,
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

/**
 * What a residential district is called when nobody lives there.
 *
 * Every one of them shares it, and that is the point: these are *plots*, not places with
 * histories. A crew moving in is what gives one a name, and the name it gets is the crew's own
 * (see {@link districtDisplayName}). The Docks were the last of them to carry an authored name and
 * that name went with them when they became ground worth fighting over.
 */
export const UNCLAIMED_DISTRICT_NAME = 'Player District';

/** Roman numerals for the plots, one per residential district the map can show besides your own. */
const PLOT_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const;

/**
 * What the other plots are called: `Player District I`, `II`, `III`, in catalogue order.
 *
 * **Numbered rather than named after whoever lives there**, and that is the design rather than a
 * shortcut. Only one crew on this map is *you*; the rest are other people's homes and the map's job
 * is to say "somebody plays there", not to publish their crew name to every player in the city. A
 * board of four different crew names also made the four plots look like four different kinds of
 * place, when the whole point of them is that they are the same kind of place.
 *
 * Viewer-relative, so the numbering always runs from one with no gap in it: your own plot is not in
 * the sequence, so a player whose home is the second of four sees I, II and III rather than I, III
 * and IV. `districtDisplayName` is the only caller and `city.test.ts` pins that the three are
 * distinct.
 */
export function plotName(index: number): string {
  return `${UNCLAIMED_DISTRICT_NAME} ${PLOT_NUMERALS[index] ?? String(index + 1)}`;
}

/**
 * Every residential district except `ownDistrictId`, in catalogue order: the plots to number.
 *
 * Exported because the numbering has to be the same on the map, on the district screen and in a
 * test, and re-deriving "which plots are not mine, in what order" at three call sites is how the
 * three come to disagree.
 */
export function otherPlots(ownDistrictId: string): readonly District[] {
  return CITY_DISTRICTS.filter(
    (district) => district.kind === 'residential' && district.id !== ownDistrictId,
  );
}

/**
 * What to call a district on a screen.
 *
 * One function because it is one rule, and every screen that names a district has to say the same
 * thing. Contested ground always answers with its authored name. Residential ground answers with
 * **your crew's name on your own plot** and with a number on everybody else's: see {@link plotName}
 * for why the other three are not named after their residents.
 *
 * Nothing is stored. Rename the crew and the map says so on the next read, which is what makes the
 * tag a fact about the world rather than a copy of one.
 */
export function districtDisplayName(
  district: District,
  viewer: { ownDistrictId?: string | null; ownName?: string | null } = {},
): string {
  if (district.kind !== 'residential') return district.name;
  if (
    viewer.ownDistrictId !== undefined &&
    viewer.ownDistrictId !== null &&
    district.id === viewer.ownDistrictId
  ) {
    return viewer.ownName !== undefined && viewer.ownName !== null && viewer.ownName.length > 0
      ? viewer.ownName
      : district.name;
  }
  const index = otherPlots(viewer.ownDistrictId ?? '').findIndex(
    (other) => other.id === district.id,
  );
  return index >= 0 ? plotName(index) : district.name;
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
function districtNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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
 * The plot numbers are reserved. A crew called `Player District II` would be indistinguishable from
 * the plot the map draws under that name, which is the same confusion `sameDistrictName` exists to
 * prevent, arriving from the other direction.
 */
export function isReservedDistrictName(name: string): boolean {
  const wanted = districtNameKey(name);
  if (wanted === districtNameKey(UNCLAIMED_DISTRICT_NAME)) return true;
  return PLOT_NUMERALS.some(
    (numeral) => wanted === districtNameKey(`${UNCLAIMED_DISTRICT_NAME} ${numeral}`),
  );
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
  rustyard: {
    title: 'Run of the Belt',
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
 * Steelbelt, the three cheapest locations in the game, and the Directorate is at the top, with the
 * Combine Spire looking down the middle of the frame from the highest point on it. Difficulty rises
 * with height almost monotonically, so "further up" and "harder" are the same direction, and a
 * player who has taken the low ground can see what the next rung is without opening anything.
 *
 * Allegiance reads left-to-right within that: independent ground on the flanks, the Directorate's
 * holdings up the centre and the right, which is why the Blacksite and the Annexes bracket the
 * approach to the Spire. `city.test.ts` pins the gradient and the spacing so a future district
 * cannot be dropped in on top of another one.
 */
export const CITY_DISTRICTS: readonly District[] = [
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
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.15, y: 0.9 },
    difficulty: 1,
    blurb:
      'Container stacks and a waterfront the Combine stopped patrolling years ago. Cheap ground, and far enough from the spire that nobody important looks at it.',
    locations: locationsIn('neon-docks', [
      ['tideline', 'The Tideline Market', 'market', 'easy'],
      ['pumphouse', 'Dockside Pumphouse', 'water_works', 'easy'],
      // Under the quay and out past the boom: the reason anything the Combine bans is cheap here.
      ['runners', "Runners' Tunnel", 'smugglers_tunnel', 'medium'],
      ['galley', 'The Wet Galley', 'soup_kitchen', 'easy'],
      // People have been living on the moored barges longer than anybody has been calling it a slum.
      ['barges', 'The Moored Barges', 'refugee_camp', 'easy'],
      // A gantry crane with a cabin at the top of it. Whoever is up there sees the whole waterfront.
      ['cranegate', 'Crane Gate', 'watchtower', 'medium'],
      ['chandler', 'The Chandlery', 'pawn_shop', 'easy'],
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
    difficulty: 4,
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
    difficulty: 2,
    blurb:
      'A long terrace along the southern cut, boilers venting into the street. Warm, loud, and nobody asks where anybody came from.',
    locations: [],
  },

  {
    id: 'rustyard',
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
    allegiance: 'independent',
    seatOfPower: false,
    position: { x: 0.63, y: 0.83 },
    difficulty: 2,
    blurb:
      'Rolling mills, press houses and a furnace row that has not gone cold in thirty years. Nobody owns the Belt outright: the crews that work it hold their own gates, and none of them holds enough of it to stop anybody else walking in.',
    locations: locationsIn('rustyard', [
      ['press', 'No. 4 Press House', 'scrap_press', 'easy'],
      ['bonefield', "The Breaker's Yard", 'war_machine_graveyard', 'hard'],
      ['pawn', 'Toolhouse Pawn', 'pawn_shop', 'easy'],
      // A drained slag pit the shift kids ride. Industrial ground put to a use nobody planned.
      ['ramp', 'The Slag Bowl', 'skate_ground', 'easy'],
      ['pumps', 'Furnace Row Pumps', 'gas_station', 'easy'],
      // Named, not renamed: the *kind* is the only `doghouse` in the city and it is what puts
      // Cyberhounds on the roster. See `units/catalog.ts`.
      ['kennels', 'The Doghouse', 'doghouse', 'medium'],
      ['bones', 'The Bone Market', 'bone_market', 'easy'],
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
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
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
    locations: locationsIn('datavault-sigma', [
      ['faculty', 'The Faculty Annexe', 'university', 'medium'],
      ['uplink', 'Annexe Uplink', 'satellite_uplink', 'hard'],
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
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
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
    name: 'Blacksite',
    nickname: 'the Military District',
    formalName: null,
    kind: 'contested',
    allegiance: 'government',
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
    locations: locationsIn('combine-spire', [
      ['uplink', 'Command Uplink', 'satellite_uplink', 'hard'],
      ['armory', 'Directorate Armory', 'armory', 'hard'],
      ['household', 'The Household Barricade', 'barricade', 'hard'],
      ['broadcast', 'Command Broadcast', 'broadcast_station', 'hard'],
      ['ascension', 'The Ascension Clinic', 'gene_clinic', 'hard'],
      ['scaffold', 'The Unfinished Wing', 'construction_site', 'hard'],
      ['martyrs', 'The Martyrs’ Ground', 'graveyard', 'medium'],
      ['statue', 'Statue of the Revolutionist', 'revolutionist_statue', 'medium'],
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
    difficulty: 2,
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
    difficulty: 1,
    blurb:
      'The tail of the market where the stalls give out and the cut comes back up to meet the street. Damp, cheap, and out of everybody else\u2019s way.',
    locations: [],
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
  return district.allegiance === 'government' && district.seatOfPower;
}

/** The garrison standing on a district when the strike team arrives (§A3). */
export function garrisonOf(district: District): string {
  return district.allegiance === 'government'
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

/** What holding the whole of `districtId` is worth, or `null` for ground with nothing to hold. */
export function unifiedBonusFor(districtId: string): UnifiedBonus | null {
  return UNIFIED_BONUSES[districtId] ?? null;
}

/** Which allegiance nominally garrisons a district's locations before anybody takes them. */
export function defaultHolderFaction(district: District): Allegiance {
  return district.allegiance;
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
