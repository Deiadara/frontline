import { z } from 'zod';
import { DEFAULT_CITY_ID } from './cities.js';
import { AllegianceSchema, governmentGarrisonFor, type Allegiance } from '../allegiance.js';
import { IdSchema } from './../primitives.js';
import {
  AUTHORED_UPGRADE_NOTES,
  COMBAT_LEVEL_SCALE,
  LocationSchema,
  type HoldBonus,
  type Location,
} from './locations.js';
import { envLabel } from './labels.js';

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
    locations: readonly LocationEntry[];
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
 * One authored location: everything it is, written on the place itself.
 *
 * Every location carries its own words, pay, ground, combat contexts, defence, upgrade price and
 * upgrade notes (maintainer, 2026-10-14: location types removed). There is no shared kind to fall
 * back on, so two platforms that pay the same say so twice, and changing one cannot move the other.
 * `icon` is the art key for its map marker and portrait, nothing more.
 */
export type LocationEntry = Omit<Location, 'id' | 'districtId'> & { slug: string };

/** Terser than `envLabel` in every location's ground. */
const L = envLabel;

/** Terser than repeating the district id in every location literal. */
function locationsIn(districtId: string, entries: readonly LocationEntry[]): Location[] {
  return entries.map(({ slug, ...rest }) => {
    const location: Location = { id: `${districtId}-${slug}`, districtId, ...rest };
    assertPlayable(location);
    return location;
  });
}

/** What every location must have, checked at load: a place that fails one is a hole in the map. */
function assertPlayable(location: Location): void {
  const { id } = location;
  if (location.bonuses.length === 0) throw new Error(`${id} is worth nothing to hold`);
  if (location.upgrades.length !== AUTHORED_UPGRADE_NOTES) {
    throw new Error(`${id} needs ${AUTHORED_UPGRADE_NOTES} upgrade notes`);
  }
  if (!Number.isInteger(location.upgradeCost) || location.upgradeCost <= 0) {
    throw new Error(`${id} has no upgrade price, so it can never be worked up`);
  }
  if (location.labels.length === 0) {
    throw new Error(`${id} has no environment labels: every ground fights like something`);
  }
  if (location.contexts.length === 0) throw new Error(`${id} says nothing about how to take it`);
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
      {
        slug: 'tideline',
        name: 'The Tideline Market',
        icon: 'market',
        blurb: 'Awnings, arguments, and a hundred people moving goods nobody has papers for.',
        reward: 'A cut of everything that changes hands.',
        bonuses: [{ kind: 'resource', resource: 'caps', perHour: 30 }],
        labels: [L('crammed', 2), L('noisy', 2), L('wet', 1)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The pitches are numbered and rented instead of fought over.',
          'A covered row along the north side, so the market keeps trading in the rain.',
          'Your own weigh house at the gate. Nothing crosses it uncounted.',
        ],
      },

      {
        slug: 'pumphouse',
        name: 'Dockside Pumphouse',
        icon: 'water_works',
        blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
        reward: 'Supplies, because clean water is most of what growing it takes.',
        bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 26 }],
        labels: [L('wet', 2), L('noisy', 1), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 150,
        upgrades: [
          'Better plumbing: the leaking main under the yard is dug up and replaced.',
          'The settling beds are dredged and the intake screens stop clogging weekly.',
          'A chlorination house at the outfall. Nothing that leaves here makes anybody ill.',
        ],
      },

      // Under the quay and out past the boom: the reason anything the Combine bans is cheap here.
      {
        slug: 'runners',
        name: "Runners' Tunnel",
        icon: 'smugglers_tunnel',
        blurb:
          'Cut by hand under the old customs line, shored with railway sleepers, and in continuous use since before anybody now alive.',
        reward:
          'Every crew you send anywhere is back sooner. There is a shorter way and you own it.',
        bonuses: [{ kind: 'mission_speed', percent: 12 }],
        labels: [L('crammed', 2), L('dark', 2), L('eerie', 1)],
        contexts: ['underground'],
        baseDefense: 4,
        upgradeCost: 250,
        upgrades: [
          'The flooded section is pumped and the shoring replaced. It is safe at a run.',
          'A second shaft at the far end, so traffic stops meeting itself in the middle.',
          'Trolley rails the whole length. What used to be a night is now an hour.',
        ],
      },

      {
        slug: 'galley',
        name: 'The Wet Galley',
        icon: 'soup_kitchen',
        blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
        reward: 'Supplies off the ration line, and a crew that has eaten fights like one.',
        bonuses: [
          { kind: 'resource', resource: 'supplies', perHour: 14 },
          { kind: 'unit_morale', flat: 6 },
          { kind: 'unit_slots', flat: 15 },
        ],
        labels: [L('crammed', 2), L('noisy', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'A second serving line, so the queue clears before the food does.',
          'Cold store out the back. Nothing is thrown away at the end of a day any more.',
          'Bread ovens. People come here who did not have to, which is worth more than the bread.',
        ],
      },

      // People have been living on the moored barges longer than anybody has been calling it a slum.
      {
        slug: 'barges',
        name: 'The Moored Barges',
        icon: 'refugee_camp',
        blurb:
          'Two thousand people along the green belt fence, in whatever they could carry, because the food is on the other side of it.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [
          { kind: 'unit_slots', flat: 50 },
          { kind: 'resource', resource: 'caps', perHour: 6 },
        ],
        labels: [L('crammed', 2), L('wet', 1), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      // A gantry crane with a cabin at the top of it. Whoever is up there sees the whole waterfront.
      // Named a Site rather than a Gate (maintainer request): a district's *gate* is a real mechanic
      // three files over, and a location whose name claimed to be one had players calling fights
      // at it expecting the district to open.
      {
        slug: 'cranegate',
        name: 'Crane Site',
        icon: 'watchtower',
        blurb:
          'A lattice mast with a cabin on top, a working pair of glasses, and a line of sight over four districts.',
        reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
        bonuses: [
          /*
           * 38: the tower's own 20, plus the sight of one district and the second scouting party it
           * paid until scouting left the game (2026-09-29), each converted at what `perkWorth` prices
           * one whole thing on a `wide` channel, nine points. It scales on `LEVEL_SCALE` like every
           * percentage, so the tower is still the best intel ground in the city at every level.
           */
          { kind: 'intel', percent: 38 },
        ],
        labels: [L('elevated', 2), L('windy', 2), L('open', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },

      {
        slug: 'chandler',
        name: 'The Chandlery',
        icon: 'pawn_shop',
        blurb: 'A barred window, a long counter, and a back room with better stock.',
        reward: 'A smaller cut, and a fence who moves what a raid brings back.',
        bonuses: [{ kind: 'loot_capacity', percent: 15 }],
        labels: [L('crammed', 2), L('dark', 1), L('wet', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 80,
        upgrades: [
          'The back room is cleared and shelved. Twice the stock, half the arguments.',
          'A second counter for people who would rather not queue where they can be seen.',
          'A yard behind with a gate on it. Whole truckloads, not armfuls.',
        ],
      },
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
     * furnaces lit, a pump row that sells to the hauliers. Same seven locations doing the same seven
     * things: the Doghouse here is on the Cyberhounds' list by id (`units/catalog.ts`), so renaming
     * the ground cannot move it. The **id** is unchanged for the same reason: every location id and
     * every saved control row is keyed on it.
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
      {
        slug: 'press',
        name: 'No. 4 Press House',
        icon: 'scrap_press',
        blurb: 'Baling presses and a sorting floor that has not stopped since before the war.',
        reward: 'Scrap, steadily, for as long as you hold it.',
        bonuses: [
          { kind: 'resource', resource: 'scrap', perHour: 24 },
          // §D5b: a press takes wrecks apart, and a wreck is not all metal. Mirrors the Scrapyard
          // building, which yields both for the same reason.
          { kind: 'resource', resource: 'planks', perHour: 18 },
        ],
        labels: [L('noisy', 3), L('crammed', 2)],
        contexts: ['urban', 'indoor'],
        baseDefense: 2,
        upgradeCost: 160,
        upgrades: [
          'The second baler comes back online and the sorting floor stops backing up.',
          'A magnetic separator over the belt, so nobody is picking metal out by hand.',
          'Night shift. The presses run until somebody stops them, and nobody does.',
        ],
      },

      {
        slug: 'bonefield',
        name: "The Breaker's Yard",
        icon: 'war_machine_graveyard',
        blurb: 'A field of dead armour, half of it sunk, some of it not as dead as it looks.',
        reward:
          'Hulls, plate and running gear, and troops that come back from more than they should.',
        bonuses: [{ kind: 'unit_vitality', percent: 10 }],
        labels: [L('open', 2), L('eerie', 2), L('toxic', 1)],
        contexts: ['open_ground'],
        baseDefense: 6,
        upgradeCost: 300,
        upgrades: [
          'A gantry crane over the north field. Whole hulls instead of what could be carried.',
          'The sunk row is dug out and drained: the best of it was always at the bottom.',
          'A cutting shop on site, so what leaves is stock rather than wreckage.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'pawn',
        name: 'Toolhouse Pawn',
        icon: 'pawn_shop',
        blurb: 'A barred window, a long counter, and a back room with better stock.',
        reward: 'A smaller cut, and a fence who moves what a raid brings back.',
        bonuses: [{ kind: 'loot_capacity', percent: 15 }],
        labels: [L('crammed', 3), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 80,
        upgrades: [
          'The back room is cleared and shelved. Twice the stock, half the arguments.',
          'A second counter for people who would rather not queue where they can be seen.',
          'A yard behind with a gate on it. Whole truckloads, not armfuls.',
        ],
      },

      // A drained slag pit the shift kids ride. Industrial ground put to a use nobody planned.
      {
        slug: 'ramp',
        name: 'The Slag Bowl',
        icon: 'skate_ground',
        blurb: 'A drained reservoir the kids took over, and then the couriers after them.',
        reward: 'Everything you field moves faster.',
        bonuses: [{ kind: 'unit_speed', percent: 12 }],
        labels: [L('open', 3), L('hot', 1)],
        contexts: ['open_ground'],
        baseDefense: 1,
        upgradeCost: 130,
        upgrades: [
          'The cracked half is resurfaced, which doubles the usable ground.',
          'Lights on poles. The couriers train after dark, which is when they work.',
          'A run built out to the street, so the practice is the route rather than a shape.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'pumps',
        name: 'Furnace Row Pumps',
        icon: 'gas_station',
        blurb:
          'Four pumps under a sagging canopy, a shop with nothing in it, and tanks underneath that turned out to be mostly full.',
        reward:
          'Oil out of the ground, and the scrap off everything anybody abandoned on the forecourt.',
        bonuses: [
          { kind: 'resource', resource: 'oil', perHour: 18 },
          { kind: 'resource', resource: 'scrap', perHour: 8 },
        ],
        labels: [L('open', 2), L('toxic', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The underground tanks are pumped out properly instead of siphoned by hand.',
          'A filtration rig in the back bay, so what comes up is worth selling.',
          'The forecourt is fenced, lit and manned. Nothing walks off it any more.',
        ],
      },

      // Named, not renamed: it puts Cyberhounds on the roster, by id. See `units/catalog.ts`.
      {
        slug: 'kennels',
        name: 'The Doghouse',
        icon: 'doghouse',
        blurb:
          'Kennels under the flyover, a surgery at the back, and forty animals that go quiet when the right person walks in.',
        reward: 'Working dogs, augmented, and handlers who have done this before.',
        bonuses: [{ kind: 'intimidation', flat: 6 }],
        labels: [L('noisy', 3), L('crammed', 1), L('dark', 1)],
        contexts: ['urban', 'indoor'],
        baseDefense: 3,
        upgradeCost: 180,
        upgrades: [
          'The surgery gets a clean room, and the survival rate stops being a talking point.',
          'A run and a scent yard, so the animals are trained rather than merely kept.',
          'A breeding line of your own. What comes out of here is better than what went in.',
        ],
      },

      // The Bone Market went to Arca's Gravefields (maintainer, 2026-10-06), and the works
      // got a canteen: the shift has to eat somewhere.
      {
        slug: 'canteen',
        name: 'The Shift Canteen',
        icon: 'soup_kitchen',
        blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
        reward: 'Supplies off the ration line, and a crew that has eaten fights like one.',
        bonuses: [
          { kind: 'resource', resource: 'supplies', perHour: 14 },
          { kind: 'unit_morale', flat: 6 },
          { kind: 'unit_slots', flat: 15 },
        ],
        labels: [L('crammed', 2), L('noisy', 2), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'A second serving line, so the queue clears before the food does.',
          'Cold store out the back. Nothing is thrown away at the end of a day any more.',
          'Bread ovens. People come here who did not have to, which is worth more than the bread.',
        ],
      },
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
      {
        slug: 'exchange',
        name: 'The Exchange',
        icon: 'downtown_market',
        blurb:
          'The old exchange floor, still trading, with the board on the wall repainted every morning by somebody who knows.',
        reward: 'Every trade in the city is quoted to you at a better number than to anybody else.',
        bonuses: [
          { kind: 'market_discount', percent: 10 },
          { kind: 'resource', resource: 'caps', perHour: 12 },
        ],
        labels: [L('noisy', 3), L('crammed', 2), L('open', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'Your people are on the floor at open, which is where the day’s price is decided.',
          'A seat on the board. The number goes up when you say it does.',
          'The clearing book runs through your hands. Everyone else trades on your terms.',
        ],
      },

      {
        slug: 'cathode',
        name: 'Cathode Tower',
        icon: 'broadcast_tower',
        blurb:
          'A mast with a working transmitter, and whoever holds it decides what the city hears.',
        reward: 'Your name arrives before your people do.',
        bonuses: [{ kind: 'intimidation', flat: 10 }],
        labels: [L('elevated', 3), L('windy', 2), L('open', 1)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 150,
        upgrades: [
          'Output doubled. The signal reaches the upper levels for the first time.',
          'A standby set, so being knocked off air stops being a thing that happens.',
          'Your own hour, every evening, and the city has started planning around it.',
        ],
      },

      {
        slug: 'overlook',
        name: 'The Overlook',
        icon: 'high_ground',
        blurb:
          'A roofline, a water tower, a spoil heap. Whatever counts as looking down around here.',
        reward: 'Everything you hold in this city is harder to take off you.',
        bonuses: [{ kind: 'defense_percent', percent: 12 }],
        labels: [L('open', 3), L('elevated', 2), L('windy', 1)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 210,
        upgrades: [
          'Sandbagged firing positions instead of whatever people were crouching behind.',
          'A cut stair up the back, so the position can be reinforced under fire.',
          'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'ferrous',
        name: 'Saint Ferrous',
        icon: 'hospital',
        blurb: 'Four working theatres, a generator, and staff who stayed when the funding did not.',
        reward: 'What comes back from a fight comes back in better shape.',
        bonuses: [{ kind: 'unit_vitality', percent: 12 }],
        labels: [L('crammed', 2), L('noisy', 2), L('eerie', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 170,
        upgrades: [
          'The generator is overhauled, so a theatre stops going dark mid-operation.',
          'A blood bank. The thing they most often ran out of stops running out.',
          'A trauma bay at the door. The ones who used to die on the step do not.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'statue',
        name: 'Statue of the Revolutionary',
        icon: 'revolutionary_statue',
        blurb:
          'The one in the middle of the district: a long coat, a raised fist, and a plinth every road in Chrome Row runs past.',
        reward:
          'It is what they are fighting for. A crew that holds it walks into a fight harder to frighten.',
        bonuses: [{ kind: 'unit_morale', flat: 10 }],
        labels: [L('open', 4), L('elevated', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 4,
        upgradeCost: 120,
        upgrades: [
          'The plinth is scrubbed and the name re-cut. People stop to read it again.',
          'Floodlit. The first thing anybody sees coming into the district, and it is yours.',
          'A crowd under it most nights. What is said there is repeated in every district.',
        ],
      },

      {
        slug: 'regal',
        name: 'The Regal',
        icon: 'cinema',
        blurb:
          'Eight hundred seats, a projector somebody has kept running out of stubbornness, and four reels left.',
        reward: 'Two hours somewhere else. A crew that gets that fights differently the next day.',
        bonuses: [{ kind: 'unit_morale', flat: 12 }],
        labels: [L('dark', 3), L('crammed', 2), L('eerie', 1)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 100,
        upgrades: [
          'The projector is rebuilt and the sound comes back. It stops being a silent film.',
          'The balcony is reopened, which is another three hundred seats a night.',
          'A print run traded in from three districts. Something different every week.',
        ],
      },

      {
        slug: 'anvil',
        name: 'The Cracked Anvil',
        icon: 'tavern',
        blurb:
          'Low ceiling, long bar, and a corner table that has been the same three people’s corner table for twenty years.',
        reward: 'A room where the city’s hardest people drink, and somebody who can introduce you.',
        bonuses: [{ kind: 'unit_morale', flat: 5 }],
        labels: [L('crammed', 3), L('noisy', 2), L('dark', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The cellar is restocked and the back room is yours whenever you want it.',
          'A door policy. The people worth meeting stop being drowned out by the people who are not.',
          'You are the house. Every introduction in this room goes through you now.',
        ],
      },

      {
        slug: 'coinop',
        name: 'Coin-Op Row',
        icon: 'arcade',
        blurb:
          'Forty cabinets, nine of them working, and a change machine that has never been robbed.',
        reward: 'Reflex work disguised as an evening off. Recruits come off the bench quicker.',
        bonuses: [{ kind: 'muster_speed', percent: 12 }],
        labels: [L('noisy', 3), L('dark', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'Half the dead cabinets are cannibalised into working ones.',
          'A back room wired for two-player rigs. People start practising on purpose.',
          'A ladder, a board, and a prize. It stops being a distraction and becomes training.',
        ],
      },
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
      {
        slug: 'substation',
        name: 'Undergrid Substation',
        icon: 'power_station',
        blurb:
          'A Combine switching yard off the old trunk, with a bunded tank farm behind it for the standby sets.',
        // §A1 took the district grid out of the game, and a location that fed it would now feed
        // nothing. Re-pointed at the fuel bunkers behind the yard rather than dropped: this was one of
        // the strongest holds on the map, and a place worth taking that pays nothing is a dead marker.
        reward: 'Fuel by the drum, off the standby tanks nobody has come back to meter.',
        bonuses: [{ kind: 'resource', resource: 'oil', perHour: 20 }],
        labels: [L('noisy', 2), L('toxic', 2), L('crammed', 1)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 230,
        upgrades: [
          'The cracked tank at the north end is patched and brought back into service.',
          'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
          'A second draw line off the spur. Twice the throughput and half the spills.',
        ],
      },

      {
        slug: 'vault9',
        name: 'Transformer Vault 9',
        icon: 'power_station',
        blurb:
          'A Combine switching yard off the old trunk, with a bunded tank farm behind it for the standby sets.',
        // §A1 took the district grid out of the game, and a location that fed it would now feed
        // nothing. Re-pointed at the fuel bunkers behind the yard rather than dropped: this was one of
        // the strongest holds on the map, and a place worth taking that pays nothing is a dead marker.
        reward: 'Fuel by the drum, off the standby tanks nobody has come back to meter.',
        bonuses: [{ kind: 'resource', resource: 'oil', perHour: 20 }],
        labels: [L('dark', 2), L('hot', 2), L('noisy', 2)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 230,
        upgrades: [
          'The cracked tank at the north end is patched and brought back into service.',
          'Valve gear replaced, so one leak stops taking the whole bund out of use with it.',
          'A second draw line off the spur. Twice the throughput and half the spills.',
        ],
      },

      {
        slug: 'junction',
        name: 'The Weeping Junction',
        icon: 'sewer_junction',
        blurb: 'A brick chamber where six storm drains meet. It goes everywhere.',
        reward: 'Your people can get places without being seen getting there.',
        bonuses: [{ kind: 'unit_stealth', percent: 15 }],
        labels: [L('crammed', 2), L('dark', 2), L('wet', 2)],
        contexts: ['underground'],
        baseDefense: 2,
        upgradeCost: 130,
        upgrades: [
          'The collapsed eastern run is dug out. Two more ways in and out.',
          'Duckboards and lamps the whole length, so a crew moves at walking pace.',
          'A mapped network with marked exits in six districts. Nobody goes the wrong way.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'reagent',
        name: 'Reagent Works',
        icon: 'chemical_plant',
        blurb: 'Cracking towers and a tank farm. Everything downwind of it tastes of it.',
        reward: 'Oil, cracked on site.',
        bonuses: [{ kind: 'resource', resource: 'oil', perHour: 14 }],
        labels: [L('toxic', 3), L('noisy', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 170,
        upgrades: [
          'The third cracking tower is repacked and lit.',
          'Feedstock lines rerouted off the ruined header. Nothing is being flared off any more.',
          'Catalyst recovery, so the expensive part of the process stops leaving in the smoke.',
        ],
      },

      {
        slug: 'customs',
        name: 'The Old Customs Run',
        icon: 'smugglers_tunnel',
        blurb:
          'Cut by hand under the old customs line, shored with railway sleepers, and in continuous use since before anybody now alive.',
        reward:
          'Every crew you send anywhere is back sooner. There is a shorter way and you own it.',
        bonuses: [{ kind: 'mission_speed', percent: 12 }],
        labels: [L('crammed', 3), L('dark', 2), L('eerie', 1)],
        contexts: ['underground'],
        baseDefense: 4,
        upgradeCost: 250,
        upgrades: [
          'The flooded section is pumped and the shoring replaced. It is safe at a run.',
          'A second shaft at the far end, so traffic stops meeting itself in the middle.',
          'Trolley rails the whole length. What used to be a night is now an hour.',
        ],
      },

      {
        slug: 'depot',
        name: 'Lamplight Depot',
        icon: 'tram_depot',
        blurb:
          'Eight roads under one roof, half the fleet still on them, and overhead line that is live in places.',
        reward:
          'The city gets smaller. Everything you send anywhere leaves sooner and arrives faster.',
        /*
         * One channel since 2026-10-07 (maintainer: "nerf the bonuses and make them percentage based
         * for now"). The depot paid 18% and four flat minutes, and the flat half was there because a
         * percentage is worth what the clock is worth: four minutes bit on the ten-minute hop next
         * door and were a rounding error on a march. Flat minutes also survived the crossing, where
         * they were never meant to matter. The four are 4 more points on the travel channel instead,
         * which bends with everything else through `travelSpeedCut`.
         */
        bonuses: [{ kind: 'travel_speed', percent: 22 }],
        labels: [L('dark', 2), L('crammed', 2), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 230,
        upgrades: [
          'Two cars are made roadworthy and the depot road is cleared to the street.',
          'The overhead is repaired as far as the junction. No more towing.',
          'A running timetable on three routes. Your people stop walking anywhere.',
        ],
      },

      {
        slug: 'lair',
        name: 'The Laundry Stair',
        icon: 'mad_scientist_lair',
        blurb:
          'Down a service stair behind a laundry: tanks, a generator, an operating table, and forty years of notes in one handwriting.',
        reward:
          'Everything needed to make something that should not exist, and the notes explaining how.',
        bonuses: [
          { kind: 'research_speed', percent: 8 },
          { kind: 'unit_offense', percent: 6 },
        ],
        labels: [L('toxic', 2), L('eerie', 2), L('dark', 1), L('crammed', 1)],
        contexts: ['underground', 'indoor'],
        baseDefense: 7,
        upgradeCost: 290,
        upgrades: [
          'The tanks are drained, cleaned and refilled. Whatever was in them is gone.',
          'Power off your own grid rather than the generator, so nothing is interrupted again.',
          'The notes are transcribed and understood. That is the upgrade, and it is the frightening one.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },
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
      {
        slug: 'faculty',
        name: 'The Faculty Annexe',
        icon: 'university',
        blurb: 'Lecture halls turned workshops, and a library nobody got round to burning.',
        reward: 'Every research project finishes sooner.',
        bonuses: [{ kind: 'research_speed', percent: 12 }],
        labels: [L('crammed', 3), L('dark', 2), L('noisy', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The east reading room is reopened and catalogued.',
          'Power to the workshops, so the equipment in them stops being furniture.',
          'Three of the old faculty come back. That is the upgrade; the rooms were never the problem.',
        ],
      },

      {
        slug: 'uplink',
        name: 'Annexe Uplink',
        icon: 'satellite_uplink',
        blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
        reward: 'What goes over the air in this city, your spies have already read.',
        // Two districts of sight until the whole city became visible (2026-09-29), converted at nine
        // points of intel a district, the rate `perkWorth` prices one whole thing on a `wide` channel.
        bonuses: [{ kind: 'intel', percent: 18 }],
        labels: [L('elevated', 3), L('windy', 3), L('open', 1)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 180,
        upgrades: [
          'The dish is re-aimed properly and the signal stops dropping out at dusk.',
          'A second receiver, so two birds can be tracked instead of one.',
          'Decryption on site. What comes down is read here rather than carried somewhere.',
        ],
      },

      {
        slug: 'ward',
        name: 'The Quiet Ward',
        icon: 'gene_clinic',
        blurb: 'Sealed theatres, cold storage, and a waiting room nobody waits in.',
        reward: 'Work can be done on people here that cannot be done anywhere else.',
        bonuses: [{ kind: 'unit_vitality', percent: 8 }],
        labels: [L('cold', 3), L('eerie', 3), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 200,
        upgrades: [
          'Theatre two is recommissioned and the cold store is stocked properly.',
          'A sequencer that works, which changes what can be attempted here at all.',
          'Three surgeons on rotation. The theatre stops being idle six days a week.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'coldrow',
        name: 'Cold Row',
        icon: 'foundry',
        blurb: 'Two cupola furnaces and a pour floor, running whenever there is fuel for it.',
        reward: 'High-quality metal. Nothing else in the city makes it in quantity.',
        bonuses: [{ kind: 'resource', resource: 'highQualityMetal', perHour: 3 }],
        labels: [L('hot', 3), L('noisy', 3), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 290,
        upgrades: [
          'The second cupola is relined and lit for the first time in a decade.',
          'A proper sand plant, so a bad mould stops costing a whole pour.',
          'Induction holding furnace. The metal comes out the same every single time.',
        ],
      },

      {
        slug: 'orrery',
        name: 'The Orrery',
        icon: 'planetarium',
        blurb:
          'A dome, a projector the size of a car, and a hundred and eighty seats nobody has sat in for years.',
        reward:
          'A room built for thinking in, and an optical bench worth more than the building around it.',
        bonuses: [
          { kind: 'research_speed', percent: 18 },
          { kind: 'intel', percent: 6 },
        ],
        labels: [L('dark', 4), L('eerie', 2), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 190,
        upgrades: [
          'The projector is rebuilt and the dome is dark again for the first time in years.',
          'The optical bench is stripped and repurposed. It is the best glass in the district.',
          'Sessions every night. Your researchers start solving things in the dark.',
        ],
      },

      {
        slug: 'loft',
        name: 'Nine Roofs',
        icon: 'pirate_radio',
        blurb:
          'A transmitter in a loft, a wire aerial over four roofs, and an operator who moves it every few weeks.',
        reward: 'You hear what the city is saying, and some of what it would rather not.',
        bonuses: [
          { kind: 'intel', percent: 12 },
          { kind: 'intimidation', flat: 3 },
        ],
        labels: [L('crammed', 3), L('dark', 2), L('elevated', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 100,
        upgrades: [
          'A directional aerial. Twice the reach and half the chance of being found.',
          'A second set in another building, so being raided stops meaning being off air.',
          'Listeners in six districts calling things in. The station stops being the source.',
        ],
      },

      // The half-built faculty tower. Also the only crane in the city outside the Spire: see the
      // note on the Colossus in `units/catalog.ts` for why that matters.
      {
        slug: 'scaffold',
        name: 'The Unfinished Faculty',
        icon: 'construction_site',
        blurb:
          'A tower crane, a poured raft the size of a city block, and thirty years of nobody finishing it.',
        reward:
          'Lifting gear nothing else in the city has. Some things can only be assembled standing up.',
        bonuses: [
          { kind: 'build_speed', percent: 10 },
          // §D5b: the one place on the map with a timber yard already on it. It paid no resource at
          // all before, which made it the only location whose whole worth was a percentage.
          { kind: 'resource', resource: 'planks', perHour: 22 },
        ],
        labels: [L('elevated', 3), L('open', 2), L('windy', 2)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 6,
        upgradeCost: 460,
        upgrades: [
          'The tower crane is recommissioned and passes a load test at full radius.',
          'A second crane on the east raft, so two things can be built at once.',
          'The site is decked, lit and enclosed. It becomes a yard rather than a hole.',
        ],
      },
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
      {
        slug: 'intake',
        name: 'Glasshouse Intake',
        icon: 'water_works',
        blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
        reward: 'Supplies, because clean water is most of what growing it takes.',
        bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 26 }],
        labels: [L('wet', 3), L('noisy', 1), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 150,
        upgrades: [
          'Better plumbing: the leaking main under the yard is dug up and replaced.',
          'The settling beds are dredged and the intake screens stop clogging weekly.',
          'A chlorination house at the outfall. Nothing that leaves here makes anybody ill.',
        ],
      },

      {
        slug: 'fieldgate',
        name: 'Fieldgate Market',
        icon: 'market',
        blurb: 'Awnings, arguments, and a hundred people moving goods nobody has papers for.',
        reward: 'A cut of everything that changes hands.',
        bonuses: [{ kind: 'resource', resource: 'caps', perHour: 30 }],
        labels: [L('crammed', 2), L('noisy', 2), L('open', 1)],
        contexts: ['urban'],
        baseDefense: 3,
        upgradeCost: 130,
        upgrades: [
          'The pitches are numbered and rented instead of fought over.',
          'A covered row along the north side, so the market keeps trading in the rain.',
          'Your own weigh house at the gate. Nothing crosses it uncounted.',
        ],
      },

      {
        slug: 'berm',
        name: 'The Berm',
        icon: 'high_ground',
        blurb:
          'A roofline, a water tower, a spoil heap. Whatever counts as looking down around here.',
        reward: 'Everything you hold in this city is harder to take off you.',
        bonuses: [{ kind: 'defense_percent', percent: 12 }],
        labels: [L('elevated', 2), L('open', 2), L('windy', 2)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 210,
        upgrades: [
          'Sandbagged firing positions instead of whatever people were crouching behind.',
          'A cut stair up the back, so the position can be reinforced under fire.',
          'Overhead cover and a ready magazine. It stops being a vantage and becomes a work.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'haulers',
        name: 'Hauler Yard',
        icon: 'rail_yard',
        blurb: 'Sidings, a turntable, and rolling stock that will move if pushed hard enough.',
        reward:
          'Bogies, axles and drive parts by the wagonload: everything the garage has been improvising.',
        bonuses: [
          { kind: 'vehicle_parts', percent: 20 },
          { kind: 'travel_speed', percent: 10 },
        ],
        labels: [L('open', 3), L('noisy', 1), L('windy', 1)],
        contexts: ['open_ground'],
        baseDefense: 4,
        upgradeCost: 270,
        upgrades: [
          'The turntable is freed off, so stock stops having to be dragged out backwards.',
          'A lifting shop over the pit road. Bogies come out whole instead of in pieces.',
          'Two sidings cleared and a locomotive that runs. The yard starts feeding itself.',
        ],
      },

      {
        slug: 'ladle',
        name: 'The Long Ladle',
        icon: 'soup_kitchen',
        blurb: 'Trestle tables, a queue that starts before dawn, and two women who never sit down.',
        reward: 'Supplies off the ration line, and a crew that has eaten fights like one.',
        bonuses: [
          { kind: 'resource', resource: 'supplies', perHour: 14 },
          { kind: 'unit_morale', flat: 6 },
          { kind: 'unit_slots', flat: 15 },
        ],
        labels: [L('crammed', 3), L('noisy', 1), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 1,
        upgradeCost: 100,
        upgrades: [
          'A second serving line, so the queue clears before the food does.',
          'Cold store out the back. Nothing is thrown away at the end of a day any more.',
          'Bread ovens. People come here who did not have to, which is worth more than the bread.',
        ],
      },

      {
        slug: 'fieldchapel',
        name: 'Chapel of the Furrow',
        icon: 'chapel',
        blurb:
          'Twelve pews, a working bell, and a man who has buried more of this district than anybody would like to count.',
        reward:
          'Everyone on your books holds together better under things that break people, and nobody runs because the person beside them did.',
        bonuses: [
          { kind: 'officer_group', group: 'mental', flat: 5 },
          /*
           * The cascade, cut (`steady_nerve`).
           *
           * A collapse in this engine spreads: one stack breaks, the next is shaken by it, and a force
           * ahead on casualties walks off in two rounds (`battle/morale.ts`). This removes that term
           * and nothing else, so a line still breaks from its own losses and from what is opposite it.
           * Deliberately the whole of the bonus rather than a share: half a cascade is a slower
           * collapse, and what a chapel buys is that the panic does not travel.
           */
          { kind: 'steady_nerve' },
        ],
        labels: [L('eerie', 2), L('dark', 2), L('cold', 1)],
        contexts: ['indoor'],
        baseDefense: 2,
        upgradeCost: 120,
        upgrades: [
          'The roof is made good and the bell rings on the hour again.',
          'A vestry for people who want to talk without a congregation listening.',
          'Somebody is here at any hour, and the district has noticed.',
        ],
      },

      // Against the fence, on the wrong side of the food.
      {
        slug: 'fence',
        name: 'The Fence Camp',
        icon: 'refugee_camp',
        blurb:
          'Two thousand people along the green belt fence, in whatever they could carry, because the food is on the other side of it.',
        reward:
          'More people than any building in your district could house, and every one of them looking for a reason to be useful.',
        bonuses: [
          { kind: 'unit_slots', flat: 50 },
          { kind: 'resource', resource: 'caps', perHour: 6 },
        ],
        labels: [L('crammed', 2), L('open', 1), L('noisy', 1), L('cold', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 1,
        upgradeCost: 170,
        upgrades: [
          'Standpipes and latrines. The camp stops being an outbreak waiting to happen.',
          'Timber and sheet steel go up where the tarpaulins were. It becomes a place people stay.',
          'A gate, a roll, and somebody keeping it. Two thousand becomes a number you can call on.',
        ],
      },

      // The glass itself, along the top of the painting (maintainer request, 2026-09-15). The
      // district was named for these and had no location standing on them.
      {
        slug: 'glasshouses',
        name: 'The Glasshouses',
        icon: 'glasshouse',
        blurb:
          'The row of glass houses along the top of the fields, lamps lit inside and windmills pumping the beds. Everything under that glass is on a Combine manifest before it is picked.',
        reward: 'Supplies straight off the beds, picked before they ever see a market.',
        /*
         * Between the Water Works (26) and the Soup Kitchen (14). The intake is what growing takes and
         * the kitchen is what is left after the Combine has weighed it; this is the growing itself,
         * so it pays less than the water it depends on and more than the ration line.
         */
        bonuses: [{ kind: 'resource', resource: 'supplies', perHour: 22 }],
        labels: [L('hot', 3), L('wet', 2), L('crammed', 1)],
        contexts: ['indoor'],
        baseDefense: 3,
        upgradeCost: 160,
        upgrades: [
          'The broken panes are glazed and the lamps rewired. Nothing freezes in the night beds any more.',
          'A second pump on the intake line, so every bed is wet on the hour instead of when somebody remembers.',
          'Racks up the walls. Three tiers of beds under the same glass, and three harvests where there was one.',
        ],
      },
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
     * thing the sign is hung on rather than a line shared with every place like it. Three were renamed the same day:
     * Motor Pool Seven, Ward Nine and Pit Seventeen lost their numbers. The slugs stayed, because
     * every saved control row is keyed on them; `pit17` now reads as a number the place no longer
     * has, and is left that way on purpose.
     */
    locations: locationsIn('blacksite', [
      {
        slug: 'armory',
        name: 'Blacksite Armory',
        icon: 'armory',
        blurb:
          'The hardened bunker at the centre of the yard, under the tower, racks lit orange inside. Everything the rifle company carries when it goes out came off those racks.',
        reward: 'Cheaper units, and a bench that will fit anything you can find a part for.',
        bonuses: [
          // 1 on `LEVEL_SCALE`: 1 at level 1, 3 at 4, 6 at 10. It was 12, so 66 at 10, the outlier
          // among the general muster cuts (maintainer, 2026-10-01).
          { kind: 'muster_cost', percent: 1 },
          { kind: 'refit_discount', percent: 20 },
        ],
        labels: [L('crammed', 4), L('dark', 2), L('cold', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 270,
        upgrades: [
          'The armourer’s bench is set up properly and somebody is on it every day.',
          'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
          'A proving butt out the back. Nothing leaves here that has not been fired.',
        ],
      },

      {
        slug: 'outer',
        name: 'Outer Berm',
        icon: 'barricade',
        blurb:
          'The fortified compound at the top of the hill, its great gate under the red-diamond banners, and the ramparts running down from it along the whole left of the yard. The only way in is under those banners.',
        reward: 'A harder approach to everything behind it, held by people who will not leave it.',
        bonuses: [
          { kind: 'defense_percent', percent: 8 },
          /*
           * The line learns the wall (`unit_mark`, `city/locations.ts`).
           *
           * Ironsides already taunt, which is the sheet that most wants `stalwart` and least deserves
           * it for free: a shield line that pulls three quarters of the fire and then runs is the exact
           * failure the taunt was written to fix. Granted rather than written onto the sheet, so it is
           * ground somebody has to hold instead of a unit that got quietly better.
           */
          { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
        ],
        labels: [L('crammed', 3), L('elevated', 3), L('windy', 1)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 260,
        upgrades: [
          'The gaps are filled and the whole line is tied together with rebar.',
          'A second course of containers, offset, so nothing has a straight run at it.',
          'Firing slits, a sally port, and a roof over the fighting step.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'watchtower',
        name: 'The Watchtower',
        icon: 'watchtower',
        blurb:
          'The tower left of centre with the searchlight on top. Whoever is up there sees the whole yard lit at once, and most of the city past it.',
        reward: 'Everything your spies do, they do better: everywhere in the city, not just here.',
        bonuses: [
          /*
           * 38: the tower's own 20, plus the sight of one district and the second scouting party it
           * paid until scouting left the game (2026-09-29), each converted at what `perkWorth` prices
           * one whole thing on a `wide` channel, nine points. It scales on `LEVEL_SCALE` like every
           * percentage, so the tower is still the best intel ground in the city at every level.
           */
          { kind: 'intel', percent: 38 },
        ],
        labels: [L('elevated', 4), L('windy', 3), L('open', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 5,
        upgradeCost: 240,
        upgrades: [
          'The cabin is glazed and manned around the clock instead of at somebody’s convenience.',
          'Optics off a dead Combine spotter post, and somebody who knows how to use them.',
          'A relay to your own district, so what is seen here is known there within the minute.',
        ],
      },

      {
        slug: 'pit17',
        name: 'Robot Pit',
        icon: 'fight_pit',
        blurb:
          'The lit ring at the bottom left of the yard. Machines are set against each other in it, and against men when the crowd wants that instead; the bookmaker takes both.',
        reward:
          'Every enemy you frighten before the first shot is worth twice the name when it dies.',
        /*
         * Double infamy for the intimidated, and nothing else (maintainer, 2026-10-06). The morale
         * and the porters' line went with the rework; the pit stopped being anybody's door the same
         * day, when the Condemned moved to the Watch Cell and the Crimson Dancer to her Stage.
         */
        bonuses: [{ kind: 'intimidated_infamy', percent: 100 }],
        labels: [L('noisy', 4), L('crammed', 3), L('hot', 1)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 130,
        upgrades: [
          'Tiered benches and a bell. Twice the crowd and four times the noise.',
          'A card every night instead of whenever somebody feels like it.',
          'A trainer on the payroll who used to be somebody. People come to lose to him.',
        ],
      },

      {
        slug: 'motorpool',
        name: 'Motor Pool',
        icon: 'war_machine_graveyard',
        blurb:
          'Trucks and tracked vehicles drawn up below the armoury, right of centre. Half of it runs, the other half is spares, and the gantry does not care which.',
        reward:
          'Hulls, plate and running gear, and troops that come back from more than they should.',
        bonuses: [{ kind: 'unit_vitality', percent: 10 }],
        labels: [L('open', 3), L('toxic', 2), L('noisy', 2)],
        contexts: ['open_ground'],
        baseDefense: 6,
        upgradeCost: 300,
        upgrades: [
          'A gantry crane over the north field. Whole hulls instead of what could be carried.',
          'The sunk row is dug out and drained: the best of it was always at the bottom.',
          'A cutting shop on site, so what leaves is stock rather than wreckage.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'drill',
        name: 'The Drill Hall',
        icon: 'gym',
        blurb:
          'The bunker at the top right, with the rifle company drawn up in ranks on the square in front of it. Drill every morning, iron every evening, nobody excused.',
        reward: 'One more session in the day than the day has room for.',
        bonuses: [{ kind: 'training_sessions', flat: 1 }],
        labels: [L('noisy', 3), L('crammed', 2), L('hot', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 2,
        upgradeCost: 140,
        upgrades: [
          'The upstairs room is cleared out, which doubles the floor.',
          'Proper plates and a rack that is not welded together. Nobody is waiting.',
          'Somebody good is running the sessions, and the sessions are worth turning up to.',
        ],
      },

      {
        slug: 'blackward',
        name: 'Psychic Ward',
        icon: 'black_clinic',
        blurb:
          'The cyan-lit room set into the high wall on the right, glass on the yard side. The Combine takes minds apart in there and puts them back the way it wants them; what walks out remembers the wall and very little else.',
        reward:
          'Syringes. Handed out before a fight, they bring somebody back to strength who had no right to be.',
        bonuses: [{ kind: 'battle_stims', flat: 2 }],
        labels: [L('eerie', 4), L('crammed', 3), L('toxic', 1)],
        contexts: ['indoor', 'underground'],
        baseDefense: 4,
        upgradeCost: 150,
        upgrades: [
          'A second bench and a chemist on it. Output goes from a trickle to a supply.',
          'Cold storage, so a batch stops going off before it is used.',
          'A formula that does not take as much out of the person it goes into.',
        ],
      },

      {
        slug: 'pile',
        name: 'The Pile',
        icon: 'nuclear_plant',
        blurb:
          'Reactor drums and a cooling tower in the far bottom-right corner, steaming. The Combine never shut it down; it only stopped saying what it was for.',
        reward:
          'High-quality metal out of the turbine hall, and a fuelling crew who make every barrel of oil you burn go further.',
        bonuses: [
          { kind: 'resource', resource: 'highQualityMetal', perHour: 5 },
          { kind: 'resource_yield', resource: 'oil', percent: 12 },
        ],
        labels: [L('toxic', 4), L('hot', 2), L('eerie', 2), L('foggy', 1)],
        contexts: ['indoor', 'underground'],
        baseDefense: 7,
        upgradeCost: 400,
        upgrades: [
          'The turbine hall is shored and lit, so the salvage crews stop working blind.',
          'One coolant loop is brought back under control. The building stops getting worse.',
          'A working shift room behind shielding. People can be in there for a whole day.',
        ],
      },
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
      {
        slug: 'uplink',
        name: 'Command Uplink',
        icon: 'satellite_uplink',
        blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
        reward: 'What goes over the air in this city, your spies have already read.',
        // Two districts of sight until the whole city became visible (2026-09-29), converted at nine
        // points of intel a district, the rate `perkWorth` prices one whole thing on a `wide` channel.
        bonuses: [{ kind: 'intel', percent: 18 }],
        labels: [L('elevated', 4), L('windy', 3), L('open', 2)],
        contexts: ['open_ground'],
        baseDefense: 5,
        upgradeCost: 180,
        upgrades: [
          'The dish is re-aimed properly and the signal stops dropping out at dusk.',
          'A second receiver, so two birds can be tracked instead of one.',
          'Decryption on site. What comes down is read here rather than carried somewhere.',
        ],
      },

      {
        slug: 'armory',
        name: 'Combine Armory',
        icon: 'armory',
        blurb: 'Racks, a workbench, and a door that took three people to open the first time.',
        reward: 'Cheaper units, and a bench that will fit anything you can find a part for.',
        bonuses: [
          // 1 on `LEVEL_SCALE`: 1 at level 1, 3 at 4, 6 at 10. It was 12, so 66 at 10, the outlier
          // among the general muster cuts (maintainer, 2026-10-01).
          { kind: 'muster_cost', percent: 1 },
          { kind: 'refit_discount', percent: 20 },
        ],
        labels: [L('crammed', 4), L('dark', 3), L('cold', 2)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 270,
        upgrades: [
          'The armourer’s bench is set up properly and somebody is on it every day.',
          'Pattern jigs, so a unit modification is repeatable instead of one man’s good afternoon.',
          'A proving butt out the back. Nothing leaves here that has not been fired.',
        ],
      },

      {
        slug: 'household',
        name: 'The Household Barricade',
        icon: 'barricade',
        blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
        reward: 'A harder approach to everything behind it, held by people who will not leave it.',
        bonuses: [
          { kind: 'defense_percent', percent: 8 },
          /*
           * The line learns the wall (`unit_mark`, `city/locations.ts`).
           *
           * Ironsides already taunt, which is the sheet that most wants `stalwart` and least deserves
           * it for free: a shield line that pulls three quarters of the fire and then runs is the exact
           * failure the taunt was written to fix. Granted rather than written onto the sheet, so it is
           * ground somebody has to hold instead of a unit that got quietly better.
           */
          { kind: 'unit_mark', unitId: 'ironsides', mark: 'stalwart' },
        ],
        labels: [L('crammed', 4), L('elevated', 3), L('cold', 1)],
        contexts: ['urban'],
        baseDefense: 5,
        upgradeCost: 260,
        upgrades: [
          'The gaps are filled and the whole line is tied together with rebar.',
          'A second course of containers, offset, so nothing has a straight run at it.',
          'Firing slits, a sally port, and a roof over the fighting step.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'broadcast',
        name: 'Command Broadcast',
        icon: 'broadcast_station',
        blurb:
          'Two studios, a records library, and a switchboard that still connects to places nobody can name.',
        reward:
          'Everyone on your books gets better at the half of the job that is talking to people.',
        bonuses: [{ kind: 'officer_group', group: 'social', flat: 5 }],
        labels: [L('crammed', 3), L('dark', 3), L('eerie', 2)],
        contexts: ['indoor', 'urban'],
        baseDefense: 4,
        upgradeCost: 130,
        upgrades: [
          'Studio two is brought back, so training stops competing with transmission.',
          'The records library is catalogued. Nine thousand hours of how people talked.',
          'A standing school. Your officers are taught here, and it shows in a room.',
        ],
      },

      {
        slug: 'ascension',
        name: 'The Ascension Clinic',
        icon: 'gene_clinic',
        blurb: 'Sealed theatres, cold storage, and a waiting room nobody waits in.',
        reward: 'Work can be done on people here that cannot be done anywhere else.',
        bonuses: [{ kind: 'unit_vitality', percent: 8 }],
        labels: [L('cold', 4), L('eerie', 3), L('crammed', 2), L('toxic', 1)],
        contexts: ['indoor'],
        baseDefense: 6,
        upgradeCost: 200,
        upgrades: [
          'Theatre two is recommissioned and the cold store is stocked properly.',
          'A sequencer that works, which changes what can be attempted here at all.',
          'Three surgeons on rotation. The theatre stops being idle six days a week.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
      },

      {
        slug: 'scaffold',
        name: 'The Unfinished Wing',
        icon: 'construction_site',
        blurb:
          'A tower crane, a poured raft the size of a city block, and thirty years of nobody finishing it.',
        reward:
          'Lifting gear nothing else in the city has. Some things can only be assembled standing up.',
        bonuses: [
          { kind: 'build_speed', percent: 10 },
          // §D5b: the one place on the map with a timber yard already on it. It paid no resource at
          // all before, which made it the only location whose whole worth was a percentage.
          { kind: 'resource', resource: 'planks', perHour: 22 },
        ],
        labels: [L('elevated', 4), L('windy', 3), L('open', 2), L('noisy', 1)],
        contexts: ['open_ground', 'urban'],
        baseDefense: 6,
        upgradeCost: 460,
        upgrades: [
          'The tower crane is recommissioned and passes a load test at full radius.',
          'A second crane on the east raft, so two things can be built at once.',
          'The site is decked, lit and enclosed. It becomes a yard rather than a hole.',
        ],
      },

      {
        slug: 'martyrs',
        name: 'The Martyrs’ Ground',
        icon: 'graveyard',
        blurb:
          'Terraced plots up the cut, the older half subsided, and a lodge at the gate with a light on.',
        reward:
          'Holding this ground says something the city does not forget, and what is buried here was buried with its rings on.',
        bonuses: [
          { kind: 'infamy_gain', percent: 15 },
          { kind: 'resource', resource: 'caps', perHour: 10 },
        ],
        labels: [L('eerie', 4), L('dark', 2), L('open', 2), L('cold', 2)],
        contexts: ['open_ground'],
        baseDefense: 3,
        upgradeCost: 100,
        upgrades: [
          'The lodge is manned and the gates are shut at night. It becomes yours visibly.',
          'The subsided terrace is worked properly instead of dug at by whoever turns up.',
          'The register is found. You know who is here, and so does everyone you tell.',
        ],
      },

      {
        slug: 'chapel',
        name: 'The Chosen Chapel',
        icon: 'combine_chapel',
        blurb:
          'A chapel in name. Glass, steel and a long table under the vault, and the room the whole city is run from. The pews were taken out a long time ago.',
        reward:
          'Your name walks in ahead of your people, and nobody you send out is frightened of anything that lives here.',
        bonuses: [
          { kind: 'intimidation', flat: 12 },
          { kind: 'unit_morale', flat: 8 },
        ],
        labels: [L('elevated', 3), L('eerie', 3), L('dark', 2), L('crammed', 1)],
        contexts: ['indoor', 'urban'],
        /**
         * The Chosen Chapel: where the Combine commands the city from (maintainer, 2026-09-19).
         *
         * The hardest ground in the game before anybody is standing on it. `baseDefense` 9 against a
         * ceiling of 7 everywhere else, and it is meant to read that way on the map: this is the one
         * location whose capture is the end of the campaign rather than a step in it, and Directive
         * Zero is stood in it (`city/combine.ts`).
         *
         * What holding it pays is deliberately the two things the Combine had and the player did not:
         * the city's fear, and the nerve that comes from having taken the room it was run from. Neither
         * is the CCS unified bonus (a market discount) and neither repeats another CCS location, which
         * `city.test.ts` holds.
         */
        baseDefense: 9,
        upgradeCost: 420,
        upgrades: [
          'The long table is yours, and the people who used to sit at it know it.',
          'The vault is lit again. Whoever looks up at the spire sees a different flag on it.',
          'Orders go out from here, and the city does what it always did with orders from here.',
        ],
        levelScale: COMBAT_LEVEL_SCALE,
        /** §D8: taking the room the Combine ran the city from is the event of the whole game. */
        captureInfamy: 40,
      },
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
