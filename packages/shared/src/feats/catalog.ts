import { CITY_DISTRICTS } from '../city/districts.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { markIndex } from '../crew/marks.js';
import type { FeatSpec } from './feats.js';
import type { FeatEra, FeatReward, FeatSize } from './rewards.js';
import type { FeatMeasure } from './measures.js';

/**
 * The feats (maintainer request, 2026-09-13): a hundred and sixty one things to go and do.
 *
 * ## How this is built, and why it is data rather than prose
 *
 * Every entry is a measure, a target and a reward, so the whole table can be checked at once:
 * `catalog.test.ts` prices every reward against the band its era and size allow, refuses a chain
 * whose targets do not climb, refuses an id used twice, and refuses a scope that names a district
 * or a building the game does not have. A catalogue this size cannot be kept honest by reading it.
 *
 * The rewards come from the nine helpers below rather than being typed out a hundred and sixty
 * times. That is not only brevity: a helper is priced once, in one place, against the survey of
 * what the live economy actually pays, so an author choosing `purse('mid', 'medium')` cannot
 * accidentally hand over four times what the feat beside it pays for the same work.
 *
 * ## What the set is trying to cover
 *
 * Achievement research splits players by what they came for, and a table that only counts kills
 * serves a quarter of them. These are grouped so that every way of playing has a ladder:
 *
 *   * **the work**: missions, the core loop, and the one every player touches;
 *   * **fighting**: declared battles, bodies committed, ground taken;
 *   * **the city**: scouting, holdings, whole districts, gates;
 *   * **the district**: buildings, traps, fittings, the things that are built and not won;
 *   * **the crew**: units, officers, the Overseer's own sheet;
 *   * **the trade**: caps earned over a lifetime, the market, the back room;
 *   * **the name**: infamy, notoriety, research, blueprints;
 *   * **people**: the faction and the post.
 *
 * The earliest step of most chains is an **instructor**: it asks for one of something, so that a
 * player who has never sent a scout is told that scouting exists by being paid to try it once.
 */

// --- the reward helpers, priced once ---

const purse = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { resources: { caps: 120, scrap: 40 } },
      medium: { resources: { caps: 600, scrap: 200, planks: 120 } },
      large: { resources: { caps: 1_800, scrap: 600, planks: 400, oil: 200 } },
    },
    mid: {
      small: { resources: { caps: 1_200, scrap: 400, oil: 150 } },
      medium: { resources: { caps: 6_000, scrap: 2_400, oil: 1_200, planks: 1_500 } },
      large: {
        resources: { caps: 20_000, scrap: 8_000, oil: 4_000, planks: 5_000, highQualityMetal: 400 },
      },
    },
    late: {
      small: { resources: { caps: 6_000, scrap: 2_000, highQualityMetal: 100 } },
      medium: {
        resources: {
          caps: 30_000,
          scrap: 12_000,
          oil: 6_000,
          planks: 6_000,
          highQualityMetal: 1_500,
        },
      },
      large: {
        resources: {
          caps: 120_000,
          scrap: 50_000,
          oil: 25_000,
          planks: 25_000,
          highQualityMetal: 6_000,
        },
      },
    },
  })[era][size];

const lesson = (era: FeatEra, size: FeatSize): FeatReward => ({
  xp: {
    early: { small: 150, medium: 900, large: 3_000 },
    mid: { small: 1_600, medium: 10_000, large: 42_000 },
    late: { small: 9_000, medium: 55_000, large: 260_000 },
  }[era][size],
});

/** Infamy. Named `street` because `name` is what the game calls the thing infamy buys. */
const street = (era: FeatEra, size: FeatSize): FeatReward => ({
  infamy: {
    early: { small: 22, medium: 130, large: 450 },
    mid: { small: 240, medium: 1_500, large: 6_000 },
    late: { small: 1_300, medium: 8_000, large: 20_000 },
  }[era][size],
});

const bodies = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { units: { razors: 4 } },
      medium: { units: { razors: 12, haulers: 4 } },
      large: { units: { razors: 30, scrapers: 12, haulers: 8 } },
    },
    mid: {
      small: { units: { breakers: 6, razors: 8 } },
      medium: { units: { ironsides: 14, snipers: 8 } },
      large: { units: { juggernauts: 12, ironsides: 30 } },
    },
    late: {
      small: { units: { ironsides: 12, breakers: 10 } },
      medium: { units: { juggernauts: 20, ironsides: 20, snipers: 20 } },
      large: { units: { juggernauts: 100, ironsides: 80, snipers: 60 } },
    },
  })[era][size];

const kit = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { items: { scrap_servo: 2 } },
      medium: { items: { scrap_servo: 4, optic_cluster: 2 } },
      large: { items: { optic_cluster: 8, scrap_servo: 10 } },
    },
    mid: {
      small: { items: { optic_cluster: 6, scrap_servo: 4 } },
      medium: { items: { rotor_hub: 4, targeting_core: 2 } },
      large: { items: { rotor_hub: 16, targeting_core: 10 } },
    },
    late: {
      small: { items: { rotor_hub: 4, optic_cluster: 8 } },
      medium: { items: { rotor_hub: 24, targeting_core: 14 } },
      large: { items: { rotor_hub: 100, targeting_core: 80 } },
    },
  })[era][size];

/** Pages of one blueprint. The only reward that points at a particular thing a crew may want. */
const leaves = (pageId: string, count: number): FeatReward => ({ items: { [pageId]: count } });

/** One-time battle boosts, straight into the stash the back room fills. */
const contraband = (...ids: [string, ...string[]]): FeatReward => ({ boosts: ids });

/**
 * Caps and a name in one go: what a fight actually pays, so what a fighting feat pays.
 *
 * The two halves step up one size behind the feat, because adding two full bundles of the
 * declared size would land a `medium` feat in the `large` band. The first attempt took both from
 * the size below instead, which undershot every `medium` by a few per cent and was caught by the
 * band check rather than by anybody reading it: purse leads, infamy follows.
 */
const spoils = (era: FeatEra, size: FeatSize): FeatReward => ({
  ...purse(era, size === 'small' ? 'small' : 'medium'),
  ...street(era, size === 'large' ? 'medium' : 'small'),
});

/** Caps and a lesson: what building something teaches, so what a building feat pays. */
const wages = (era: FeatEra, size: FeatSize): FeatReward => ({
  ...purse(era, size),
  ...lesson(era, size === 'large' ? 'medium' : 'small'),
});

// --- the builders ---

interface Step {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly era: FeatEra;
  readonly size: FeatSize;
  readonly target: number;
  readonly reward: FeatReward;
}

/**
 * A ladder: the same question with a bigger number each time, each step locked behind the last.
 *
 * `after` is wired here rather than typed out, because a chain whose third step points at its
 * first is the one mistake in this file that no reviewer would catch and every player would.
 */
function chain(
  chainId: string,
  measure: FeatMeasure,
  steps: readonly Step[],
  scope?: string,
): FeatSpec[] {
  return steps.map((step, index) => ({
    id: step.id,
    name: step.name,
    blurb: step.blurb,
    era: step.era,
    size: step.size,
    chain: chainId,
    after: index === 0 ? null : (steps[index - 1]?.id ?? null),
    measure,
    ...(scope === undefined ? {} : { scope }),
    target: step.target,
    reward: step.reward,
  }));
}

/** A feat that stands alone. Never locked, per the maintainer's rule. */
function solo(step: Step, measure: FeatMeasure, scope?: string): FeatSpec {
  return {
    id: step.id,
    name: step.name,
    blurb: step.blurb,
    era: step.era,
    size: step.size,
    chain: null,
    after: null,
    measure,
    ...(scope === undefined ? {} : { scope }),
    target: step.target,
    reward: step.reward,
  };
}

// --- the work ---

const WORK: FeatSpec[] = [
  ...chain('runs', 'missions_done', [
    {
      id: 'runs_1',
      name: 'Out the Gate',
      blurb: 'Send the crew out and get them home again. Five times.',
      era: 'early',
      size: 'small',
      target: 5,
      reward: purse('early', 'small'),
    },
    {
      id: 'runs_2',
      name: 'A Working Week',
      blurb: 'Twenty five jobs off the board. The crew stops asking where they are going.',
      era: 'early',
      size: 'medium',
      target: 25,
      reward: purse('early', 'medium'),
    },
    {
      id: 'runs_3',
      name: 'Regulars',
      blurb: 'A hundred runs. Somebody keeps the ledger now.',
      era: 'mid',
      size: 'medium',
      target: 100,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'runs_4',
      name: 'The Firm',
      blurb: 'Four hundred. Nobody in the city has to be told who you are.',
      era: 'late',
      size: 'medium',
      target: 400,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('clean', 'missions_won', [
    {
      id: 'clean_1',
      name: 'Clean Work',
      blurb: 'Ten jobs that came off. Failure is the tax, not the trade.',
      era: 'early',
      size: 'small',
      target: 10,
      reward: lesson('early', 'small'),
    },
    {
      id: 'clean_2',
      name: 'Reliable',
      blurb: 'Sixty clean runs. The odds stop being a rumour.',
      era: 'mid',
      size: 'small',
      target: 60,
      reward: lesson('mid', 'small'),
    },
    {
      id: 'clean_3',
      name: 'Never Yet Failed Us',
      blurb: 'Two hundred and fifty. The word for that is a reputation.',
      era: 'late',
      size: 'medium',
      target: 250,
      reward: lesson('late', 'medium'),
    },
  ]),
  ...chain(
    'raids',
    'missions_of_kind',
    [
      {
        id: 'raids_1',
        name: 'Shooting Work',
        blurb: 'Five jobs where somebody was standing on it.',
        era: 'early',
        size: 'small',
        target: 5,
        reward: street('early', 'small'),
      },
      {
        id: 'raids_2',
        name: 'The Loud Half',
        blurb: 'Forty. You have stopped picking the quiet ones.',
        era: 'mid',
        size: 'medium',
        target: 40,
        reward: street('mid', 'medium'),
      },
      {
        id: 'raids_3',
        name: 'Nothing Quiet Left',
        blurb: 'A hundred and fifty raids. The board keeps a card for you.',
        era: 'late',
        size: 'medium',
        target: 150,
        reward: street('late', 'medium'),
      },
    ],
    'battle',
  ),
  ...chain(
    'hauls',
    'missions_of_kind',
    [
      {
        id: 'hauls_1',
        name: 'Quiet Money',
        blurb: 'Ten jobs nobody shot at. It pays less and everybody comes back.',
        era: 'early',
        size: 'small',
        target: 10,
        reward: purse('early', 'small'),
      },
      {
        id: 'hauls_2',
        name: 'The Long Way Round',
        blurb: 'Seventy five. Somebody has to carry it.',
        era: 'mid',
        size: 'small',
        target: 75,
        reward: purse('mid', 'small'),
      },
      {
        id: 'hauls_3',
        name: 'Freight',
        blurb: 'Three hundred hauls. The trucks know the roads themselves.',
        era: 'late',
        size: 'medium',
        target: 300,
        reward: purse('late', 'medium'),
      },
    ],
    'standard',
  ),
  ...chain(
    'oddjobs',
    'missions_in_area',
    [
      {
        id: 'oddjobs_1',
        name: 'Whatever Is Going',
        blurb: 'Three miscellaneous jobs. The board always has those.',
        era: 'early',
        size: 'small',
        target: 3,
        reward: purse('early', 'small'),
      },
      {
        id: 'oddjobs_2',
        name: 'Odd Jobs',
        blurb: 'Twenty off the miscellaneous board. Nothing grand, all of it paid.',
        era: 'early',
        size: 'medium',
        target: 20,
        reward: purse('early', 'medium'),
      },
      {
        id: 'oddjobs_3',
        name: 'Anything At All',
        blurb: 'Seventy five. You are the number people call when it is nobody else.',
        era: 'mid',
        size: 'medium',
        target: 75,
        reward: purse('mid', 'medium'),
      },
    ],
    MISC_AREA_ID,
  ),
];

/**
 * Twenty five runs in each contested district, which is the maintainer's own example.
 *
 * Generated off `CITY_DISTRICTS` rather than typed out, so a district authored next year arrives
 * with its feat already on the screen. Contested ground only: the residential districts are where
 * crews live, they all share one authored name, and three feats reading "twenty five in Player
 * District" would be the wall of identical sentences these are grouped to avoid.
 *
 * The era comes off the district's own difficulty, so the deep ground is a late feat without
 * anybody having to remember to say so.
 */
const DISTRICT_WORK: FeatSpec[] = CITY_DISTRICTS.filter(
  (district) => district.kind === 'contested',
).map((district) => {
  const era: FeatEra =
    district.difficulty <= 2 ? 'early' : district.difficulty <= 5 ? 'mid' : 'late';
  return solo(
    {
      id: `area_${district.id.replace(/-/g, '_')}`,
      name: `Twenty Five in ${district.name}`,
      blurb: `Run twenty five jobs out of ${district.name}. Learn one piece of ground properly.`,
      era,
      size: 'medium',
      target: 25,
      reward: purse(era, 'medium'),
    },
    'missions_in_area',
    district.id,
  );
});

// --- fighting ---

const FIGHTING: FeatSpec[] = [
  ...chain('fights', 'battles_fought', [
    {
      id: 'fights_1',
      name: 'First Blood',
      blurb: 'Stand in one declared fight, either side of it.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: street('early', 'small'),
    },
    {
      id: 'fights_2',
      name: 'Known For It',
      blurb: 'Ten fights. People start checking where you are before they call one.',
      era: 'early',
      size: 'medium',
      target: 10,
      reward: street('early', 'medium'),
    },
    {
      id: 'fights_3',
      name: 'A Standing Army',
      blurb: 'Fifty. The city has a shape and you are part of it.',
      era: 'mid',
      size: 'medium',
      target: 50,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'fights_4',
      name: 'The War',
      blurb: 'Two hundred fights. Somebody will write this down eventually.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: spoils('late', 'large'),
    },
  ]),
  ...chain('wins', 'battles_won', [
    {
      id: 'wins_1',
      name: 'Win One',
      blurb: 'Take a fight and hold the ground at the end of it.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: street('early', 'medium'),
    },
    {
      id: 'wins_2',
      name: 'Ten Straight',
      blurb: 'Ten wins. The first one was luck. These are not.',
      era: 'mid',
      size: 'medium',
      target: 10,
      reward: street('mid', 'medium'),
    },
    {
      id: 'wins_3',
      name: 'Undefeated Enough',
      blurb: 'Fifty wins. Nobody counts your losses out loud any more.',
      era: 'late',
      size: 'medium',
      target: 50,
      reward: street('late', 'medium'),
    },
  ]),
  ...chain('attack', 'battles_attacked_won', [
    {
      id: 'attack_1',
      name: 'Go and Take It',
      blurb: 'Win five fights you called yourself.',
      era: 'early',
      size: 'medium',
      target: 5,
      reward: spoils('early', 'medium'),
    },
    {
      id: 'attack_2',
      name: 'On the Front Foot',
      blurb: 'Twenty five. Waiting is for people with less to gain.',
      era: 'mid',
      size: 'medium',
      target: 25,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'attack_3',
      name: 'Everything Is Somebody Else’s',
      blurb: 'A hundred fights called and won. The map moves when you walk.',
      era: 'late',
      size: 'large',
      target: 100,
      reward: spoils('late', 'large'),
    },
  ]),
  ...chain('defend', 'battles_defended_won', [
    {
      id: 'defend_1',
      name: 'Hold the Door',
      blurb: 'Turn back three fights called on your ground.',
      era: 'early',
      size: 'medium',
      target: 3,
      reward: purse('early', 'medium'),
    },
    {
      id: 'defend_2',
      name: 'Nobody Gets In',
      blurb: 'Fifteen holds. The Gate is doing what it was built for.',
      era: 'mid',
      size: 'medium',
      target: 15,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'defend_3',
      name: 'They Stopped Trying',
      blurb: 'Sixty holds. The street finds somewhere easier to be.',
      era: 'late',
      size: 'large',
      target: 60,
      reward: purse('late', 'large'),
    },
  ]),
  ...chain('deployed', 'bodies_deployed', [
    {
      id: 'deployed_1',
      name: 'Send Somebody',
      blurb: 'Commit fifty bodies to declared fights. They do not all come back.',
      era: 'early',
      size: 'small',
      target: 50,
      reward: bodies('early', 'small'),
    },
    {
      id: 'deployed_2',
      name: 'A Column',
      blurb: 'Five hundred bodies committed. The quartermaster has opinions.',
      era: 'mid',
      size: 'small',
      target: 500,
      reward: bodies('mid', 'small'),
    },
    {
      id: 'deployed_3',
      name: 'Numbers',
      blurb: 'Five thousand. You stopped knowing their names a long way back.',
      era: 'late',
      size: 'medium',
      target: 5_000,
      reward: bodies('late', 'medium'),
    },
  ]),
  ...chain('muster', 'supply_deployed', [
    {
      id: 'muster_1',
      name: 'A Hundred on the Ground',
      blurb: 'Field units worth a hundred population across your fights.',
      era: 'early',
      size: 'medium',
      target: 100,
      reward: bodies('early', 'medium'),
    },
    {
      id: 'muster_2',
      name: 'Five Hundred',
      blurb: 'The same again, five times over. Beds are the real limit.',
      era: 'mid',
      size: 'medium',
      target: 500,
      reward: bodies('mid', 'medium'),
    },
    {
      id: 'muster_3',
      name: 'Two and a Half Thousand',
      blurb: 'Population enough to empty a district. Most of it was yours.',
      era: 'late',
      size: 'large',
      target: 2_500,
      reward: bodies('late', 'large'),
    },
  ]),
  ...chain('kills', 'kills', [
    {
      id: 'kills_1',
      name: 'Twenty Five Down',
      blurb: 'The other side stops being an abstraction.',
      era: 'early',
      size: 'small',
      target: 25,
      reward: street('early', 'small'),
    },
    {
      id: 'kills_2',
      name: 'Five Hundred Down',
      blurb: 'Killed in fights you were part of. The Infirmary has seen worse weeks.',
      era: 'mid',
      size: 'medium',
      target: 500,
      reward: street('mid', 'medium'),
    },
    {
      id: 'kills_3',
      name: 'A Number, Not a Word',
      blurb: 'Five thousand killed. There is no way to say that which is not a number.',
      era: 'late',
      size: 'large',
      target: 5_000,
      reward: street('late', 'large'),
    },
  ]),
];

// --- the city ---

const CITY: FeatSpec[] = [
  ...chain('holdings', 'locations_held', [
    {
      id: 'holdings_1',
      name: 'Something of Your Own',
      blurb: 'Hold one location in the city.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: wages('early', 'medium'),
    },
    {
      id: 'holdings_2',
      name: 'A Portfolio',
      blurb: 'Five at once. Each one pays while you are asleep.',
      era: 'mid',
      size: 'medium',
      target: 5,
      reward: wages('mid', 'medium'),
    },
    {
      id: 'holdings_3',
      name: 'Landlord',
      blurb: 'Fifteen holdings standing in your name on the same evening.',
      era: 'late',
      size: 'large',
      target: 15,
      reward: wages('late', 'large'),
    },
  ]),
  ...chain('taken', 'locations_captured', [
    {
      id: 'taken_1',
      name: 'Took It Off Them',
      blurb: 'Capture a location somebody else was holding.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: spoils('early', 'medium'),
    },
    {
      id: 'taken_2',
      name: 'Ten Changes of Hands',
      blurb: 'Ten captures. The map has your fingerprints on it.',
      era: 'mid',
      size: 'medium',
      target: 10,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'taken_3',
      name: 'Forty',
      blurb: 'Forty places that used to be somebody else’s.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: spoils('late', 'large'),
    },
  ]),
  ...chain('whole', 'districts_held_whole', [
    {
      id: 'whole_1',
      name: 'The Whole Street',
      blurb: 'Hold every location in one district at once.',
      era: 'mid',
      size: 'large',
      target: 1,
      reward: wages('mid', 'large'),
    },
    {
      id: 'whole_2',
      name: 'Three Districts',
      blurb: 'Three, end to end, at the same time. The unified bonus on all of them.',
      era: 'late',
      size: 'medium',
      target: 3,
      reward: wages('late', 'medium'),
    },
    {
      id: 'whole_3',
      name: 'Half the City',
      blurb: 'Six districts held whole. Somebody should be doing something about you.',
      era: 'late',
      size: 'large',
      target: 6,
      reward: wages('late', 'large'),
    },
  ]),
  ...chain('gates', 'gates_captured', [
    {
      id: 'gates_1',
      name: 'Through the Gate',
      blurb: 'Take a district gate. The way in belongs to whoever holds it.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'gates_2',
      name: 'Five Gates',
      blurb: 'Five doors into the city, all of them answering to you.',
      era: 'late',
      size: 'medium',
      target: 5,
      reward: spoils('late', 'medium'),
    },
  ]),
  ...chain('scouted', 'districts_scouted', [
    {
      id: 'scouted_1',
      name: 'Have a Look',
      blurb: 'Walk three districts. The fog is only fog until somebody goes.',
      era: 'early',
      size: 'small',
      target: 3,
      reward: lesson('early', 'small'),
    },
    {
      id: 'scouted_2',
      name: 'Eight Streets',
      blurb: 'Eight districts scouted. You can read the map without guessing.',
      era: 'early',
      size: 'medium',
      target: 8,
      reward: lesson('early', 'medium'),
    },
    {
      id: 'scouted_3',
      name: 'Nowhere Left Dark',
      blurb: 'Twelve districts walked. There is nothing on that map you have not seen.',
      era: 'mid',
      size: 'medium',
      target: 12,
      reward: lesson('mid', 'medium'),
    },
  ]),
  ...chain('scouting', 'scouting_runs', [
    {
      id: 'scouting_1',
      name: 'Send a Scout',
      blurb: 'Five scouting runs. Cheap, quiet, and it tells you where not to go.',
      era: 'early',
      size: 'small',
      target: 5,
      reward: kit('early', 'small'),
    },
    {
      id: 'scouting_2',
      name: 'Eyes Out',
      blurb: 'Forty runs. Nothing moves in this city that you hear about second.',
      era: 'mid',
      size: 'small',
      target: 40,
      reward: kit('mid', 'small'),
    },
    {
      id: 'scouting_3',
      name: 'The Standing Watch',
      blurb: 'A hundred and fifty. Somebody is always out there.',
      era: 'late',
      size: 'small',
      target: 150,
      reward: kit('late', 'small'),
    },
  ]),
];

// --- the district ---

const DISTRICT: FeatSpec[] = [
  ...chain(
    'nexus',
    'building_level',
    [
      {
        id: 'nexus_1',
        name: 'A Roof and a Desk',
        blurb: 'Raise the Nexus to three. Everything else answers to it.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'nexus_2',
        name: 'A Real Operation',
        blurb: 'Nexus eight. The permissions table stops being the thing in your way.',
        era: 'mid',
        size: 'medium',
        target: 8,
        reward: wages('mid', 'medium'),
      },
      {
        id: 'nexus_3',
        name: 'Headquarters',
        blurb: 'Nexus fifteen. People come to you now.',
        era: 'late',
        size: 'medium',
        target: 15,
        reward: wages('late', 'medium'),
      },
      {
        id: 'nexus_4',
        name: 'As High As It Goes',
        blurb: 'Nexus twenty. There is no level twenty one.',
        era: 'late',
        size: 'large',
        target: 20,
        reward: wages('late', 'large'),
      },
    ],
    'nexus',
  ),
  ...chain('raised', 'buildings_raised', [
    {
      id: 'raised_1',
      name: 'Something Standing',
      blurb: 'Finish five building levels. Concrete, not plans.',
      era: 'early',
      size: 'small',
      target: 5,
      reward: purse('early', 'small'),
    },
    {
      id: 'raised_2',
      name: 'A Skyline',
      blurb: 'Forty levels raised. The district looks different from the road.',
      era: 'mid',
      size: 'medium',
      target: 40,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'raised_3',
      name: 'Builders',
      blurb: 'A hundred and twenty levels. Somebody has poured a lot of floor.',
      era: 'late',
      size: 'medium',
      target: 120,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('estate', 'buildings_total', [
    {
      id: 'estate_1',
      name: 'Ten Between Them',
      blurb: 'Ten levels of building standing at once, however you split them.',
      era: 'early',
      size: 'medium',
      target: 10,
      reward: wages('early', 'medium'),
    },
    {
      id: 'estate_2',
      name: 'Fifty',
      blurb: 'Fifty levels standing. Production you can feel.',
      era: 'mid',
      size: 'medium',
      target: 50,
      reward: wages('mid', 'medium'),
    },
    {
      id: 'estate_3',
      name: 'A Hundred and Forty',
      blurb: 'Every building you have, most of the way up.',
      era: 'late',
      size: 'large',
      target: 140,
      reward: wages('late', 'large'),
    },
  ]),
  ...chain(
    'gate',
    'building_level',
    [
      {
        id: 'gate_1',
        name: 'Shut the Gate',
        blurb: 'Your Gate at three. The first thing anybody coming for you meets.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: purse('early', 'medium'),
      },
      {
        id: 'gate_2',
        name: 'A Serious Door',
        blurb: 'Gate ten. They will need a reason and a plan.',
        era: 'mid',
        size: 'medium',
        target: 10,
        reward: purse('mid', 'medium'),
      },
    ],
    'gate',
  ),
  ...chain(
    'lab',
    'building_level',
    [
      {
        id: 'lab_1',
        name: 'Somewhere to Think',
        blurb: 'The Lab at two. Programmes and blueprints both start here.',
        era: 'early',
        size: 'medium',
        target: 2,
        reward: kit('early', 'medium'),
      },
      {
        id: 'lab_2',
        name: 'The Archive',
        blurb: 'Lab eight. The long programmes stop being out of reach.',
        era: 'mid',
        size: 'medium',
        target: 8,
        reward: kit('mid', 'medium'),
      },
    ],
    'lab',
  ),
  ...chain(
    'garage',
    'building_level',
    [
      {
        id: 'garage_1',
        name: 'Under Cover',
        blurb: 'Put up a Garage. Nobody prefers going there on foot.',
        era: 'mid',
        size: 'medium',
        target: 1,
        reward: purse('mid', 'medium'),
      },
      {
        id: 'garage_2',
        name: 'A Real Yard',
        blurb: 'Garage eight. The big machines need somewhere to be.',
        era: 'late',
        size: 'medium',
        target: 8,
        reward: purse('late', 'medium'),
      },
    ],
    'garage',
  ),
  ...chain('traps', 'traps_built', [
    {
      id: 'traps_1',
      name: 'Something Nasty',
      blurb: 'Set one trap on your own ground.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: kit('early', 'small'),
    },
    {
      id: 'traps_2',
      name: 'Ten Surprises',
      blurb: 'Ten traps built. The approach is not a walk any more.',
      era: 'mid',
      size: 'small',
      target: 10,
      reward: kit('mid', 'small'),
    },
    {
      id: 'traps_3',
      name: 'The Whole Yard Is a Trap',
      blurb: 'Forty. There is no safe line through it.',
      era: 'late',
      size: 'small',
      target: 40,
      reward: kit('late', 'small'),
    },
  ]),
  ...chain('addons', 'addons_built', [
    {
      id: 'addons_1',
      name: 'Fitted Out',
      blurb: 'Three modifications, refits or traps out of the Scrapyard.',
      era: 'early',
      size: 'small',
      target: 3,
      reward: kit('early', 'small'),
    },
    {
      id: 'addons_2',
      name: 'The Yard Earns Its Keep',
      blurb: 'Twenty five fittings. Everything you own has been improved once.',
      era: 'mid',
      size: 'small',
      target: 25,
      reward: kit('mid', 'small'),
    },
    {
      id: 'addons_3',
      name: 'Nothing Left Standard',
      blurb: 'Eighty fittings cut, welded and bolted on.',
      era: 'late',
      size: 'medium',
      target: 80,
      reward: kit('late', 'medium'),
    },
  ]),
];

// --- the crew ---

const CREW: FeatSpec[] = [
  ...chain('roster', 'army_bodies', [
    {
      id: 'roster_1',
      name: 'Twenty at Home',
      blurb: 'Twenty bodies standing in your district at once.',
      era: 'early',
      size: 'small',
      target: 20,
      reward: purse('early', 'small'),
    },
    {
      id: 'roster_2',
      name: 'A Hundred and Fifty',
      blurb: 'Enough to hold the ground and still send somebody out.',
      era: 'mid',
      size: 'small',
      target: 150,
      reward: purse('mid', 'small'),
    },
    {
      id: 'roster_3',
      name: 'Six Hundred',
      blurb: 'The Quarters are full and the Greenhouse is working for a living.',
      era: 'late',
      size: 'medium',
      target: 600,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('beds', 'army_supply', [
    {
      id: 'beds_1',
      name: 'Forty Beds Full',
      blurb: 'Hold units worth forty population at home. The Quarters decide how many.',
      era: 'early',
      size: 'small',
      target: 40,
      reward: purse('early', 'small'),
    },
    {
      id: 'beds_2',
      name: 'Three Hundred',
      blurb: 'Population standing in your district. Most of it eats.',
      era: 'mid',
      size: 'small',
      target: 300,
      reward: purse('mid', 'small'),
    },
    {
      id: 'beds_3',
      name: 'A Thousand at Home',
      blurb: 'A thousand population under your roof, all of it fed.',
      era: 'late',
      size: 'medium',
      target: 1_000,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('trained', 'units_trained', [
    {
      id: 'trained_1',
      name: 'Put Them Through It',
      blurb: 'Train twenty five bodies, start to finish.',
      era: 'early',
      size: 'small',
      target: 25,
      reward: lesson('early', 'small'),
    },
    {
      id: 'trained_2',
      name: 'The Drill Yard',
      blurb: 'Four hundred trained. The queue never empties.',
      era: 'mid',
      size: 'medium',
      target: 400,
      reward: lesson('mid', 'medium'),
    },
    {
      id: 'trained_3',
      name: 'Two Thousand Through the Gate',
      blurb: 'Most of them are not here any more. You trained them anyway.',
      era: 'late',
      size: 'medium',
      target: 2_000,
      reward: lesson('late', 'medium'),
    },
  ]),
  ...chain('kinds', 'unit_kinds_held', [
    {
      id: 'kinds_1',
      name: 'Three Kinds of Trouble',
      blurb: 'Hold three different sorts of unit at once.',
      era: 'early',
      size: 'small',
      target: 3,
      reward: purse('early', 'small'),
    },
    {
      id: 'kinds_2',
      name: 'Combined Arms',
      blurb: 'Eight kinds on the roster. Something for every sort of ground.',
      era: 'mid',
      size: 'medium',
      target: 8,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'kinds_3',
      name: 'The Whole Catalogue',
      blurb: 'Fifteen kinds standing at once. Somebody has been collecting.',
      era: 'late',
      size: 'medium',
      target: 15,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('officers', 'officers_held', [
    {
      id: 'officers_1',
      name: 'Somebody in Charge',
      blurb: 'Keep one officer on the books.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: purse('early', 'medium'),
    },
    {
      id: 'officers_2',
      name: 'A Command',
      blurb: 'Four officers at once, and the payroll to hold them.',
      era: 'mid',
      size: 'medium',
      target: 4,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'officers_3',
      name: 'A Staff',
      blurb: 'Eight officers. Somebody good for every chair.',
      era: 'late',
      size: 'medium',
      target: 8,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('hired', 'officers_hired', [
    {
      id: 'hired_1',
      name: 'Sign Somebody',
      blurb: 'Take on your first officer at the Bar.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: lesson('early', 'small'),
    },
    {
      id: 'hired_2',
      name: 'A Known Buyer',
      blurb: 'Ten signings. The room quietens a little when you come in.',
      era: 'mid',
      size: 'small',
      target: 10,
      reward: lesson('mid', 'small'),
    },
    {
      id: 'hired_3',
      name: 'Everybody Has Worked For You',
      blurb: 'Thirty signings. Half the city has your name on a contract.',
      era: 'late',
      size: 'small',
      target: 30,
      reward: lesson('late', 'small'),
    },
  ]),
  ...chain('mark', 'officer_best_mark', [
    {
      id: 'mark_1',
      name: 'Marked D',
      blurb: 'Hold an officer whose card reads D or better.',
      era: 'early',
      size: 'medium',
      target: markIndex('D'),
      reward: lesson('early', 'medium'),
    },
    {
      id: 'mark_2',
      name: 'Marked B',
      blurb: 'B or better. Whoever it is, they are the reason the numbers moved.',
      era: 'mid',
      size: 'medium',
      target: markIndex('B'),
      reward: lesson('mid', 'medium'),
    },
    {
      id: 'mark_3',
      name: 'Marked S',
      blurb: 'S. There are not many of these and you have one.',
      era: 'late',
      size: 'large',
      target: markIndex('S'),
      reward: lesson('late', 'large'),
    },
  ]),
  ...chain(
    'overseer',
    'overseer_skills_at',
    [
      {
        id: 'overseer_1',
        name: 'Three Above Fifty',
        blurb: 'Get your Overseer to three skills of fifty or better.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: lesson('early', 'medium'),
      },
      {
        id: 'overseer_2',
        name: 'Six Above Fifty',
        blurb: 'Six. The drills are doing what drills do.',
        era: 'mid',
        size: 'medium',
        target: 6,
        reward: lesson('mid', 'medium'),
      },
      {
        id: 'overseer_3',
        name: 'Ten Above Fifty',
        blurb: 'Ten skills at fifty or better. There is very little you cannot lead yourself.',
        era: 'late',
        size: 'large',
        target: 10,
        reward: lesson('late', 'large'),
      },
    ],
    '50',
  ),
  ...chain('peak', 'overseer_best_skill', [
    {
      id: 'peak_1',
      name: 'Good At One Thing',
      blurb: 'Sixty in any one of your Overseer’s skills.',
      era: 'early',
      size: 'medium',
      target: 60,
      reward: lesson('early', 'medium'),
    },
    {
      id: 'peak_2',
      name: 'Eighty',
      blurb: 'The band where a skill starts paying its bonus properly.',
      era: 'mid',
      size: 'medium',
      target: 80,
      reward: lesson('mid', 'medium'),
    },
    {
      id: 'peak_3',
      name: 'Ninety Five',
      blurb: 'Five points off the ceiling. The last ones take the longest.',
      era: 'late',
      size: 'medium',
      target: 95,
      reward: lesson('late', 'medium'),
    },
  ]),
  ...chain('fleet', 'fleet_size', [
    {
      id: 'fleet_1',
      name: 'Something With Wheels',
      blurb: 'Keep one machine in the Garage.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'fleet_2',
      name: 'A Convoy',
      blurb: 'Five machines. The road stops being the slow part.',
      era: 'late',
      size: 'medium',
      target: 5,
      reward: purse('late', 'medium'),
    },
    {
      id: 'fleet_3',
      name: 'A Motor Pool',
      blurb: 'Twelve machines standing. Nobody walks anywhere.',
      era: 'late',
      size: 'large',
      target: 12,
      reward: purse('late', 'large'),
    },
  ]),
  ...chain('vehicles', 'vehicles_built', [
    {
      id: 'vehicles_1',
      name: 'Built, Not Bought',
      blurb: 'Put one machine together yourself.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: kit('mid', 'medium'),
    },
    {
      id: 'vehicles_2',
      name: 'The Line',
      blurb: 'Six machines built. The Garage never goes cold.',
      era: 'late',
      size: 'medium',
      target: 6,
      reward: kit('late', 'medium'),
    },
  ]),
];

// --- the trade ---

const TRADE: FeatSpec[] = [
  ...chain(
    'caps',
    'resources_earned',
    [
      {
        id: 'caps_1',
        name: 'Five Thousand Through the Till',
        blurb: 'Earn five thousand caps in total. Spending them does not undo it.',
        era: 'early',
        size: 'medium',
        target: 5_000,
        reward: purse('early', 'medium'),
      },
      {
        id: 'caps_2',
        name: 'A Quarter Million',
        blurb: 'Two hundred and fifty thousand caps earned, ever.',
        era: 'mid',
        size: 'medium',
        target: 250_000,
        reward: purse('mid', 'medium'),
      },
      {
        id: 'caps_3',
        name: 'Three Million',
        blurb: 'Through your hands over a lifetime. Very little of it stayed.',
        era: 'late',
        size: 'large',
        target: 3_000_000,
        reward: purse('late', 'large'),
      },
    ],
    'caps',
  ),
  ...chain(
    'metal',
    'resources_earned',
    [
      {
        id: 'metal_1',
        name: 'A Hundred Ingots',
        blurb: 'Earn a hundred high quality metal. It is the bottleneck for everything good.',
        era: 'early',
        size: 'medium',
        target: 100,
        reward: kit('early', 'medium'),
      },
      {
        id: 'metal_2',
        name: 'Five Thousand',
        blurb: 'Enough alloy to matter. Most of it is already spent.',
        era: 'mid',
        size: 'medium',
        target: 5_000,
        reward: kit('mid', 'medium'),
      },
      {
        id: 'metal_3',
        name: 'Fifty Thousand',
        blurb: 'A lifetime of pulling metal out of the city.',
        era: 'late',
        size: 'medium',
        target: 50_000,
        reward: kit('late', 'medium'),
      },
    ],
    'highQualityMetal',
  ),
  ...chain(
    'stock',
    'resources_held',
    [
      {
        id: 'stock_1',
        name: 'Two Thousand Scrap',
        blurb: 'Hold it all at once. The Apothecary decides whether you can.',
        era: 'early',
        size: 'medium',
        target: 2_000,
        reward: purse('early', 'medium'),
      },
      {
        id: 'stock_2',
        name: 'Forty Thousand Scrap',
        blurb: 'Standing in the yard, right now. That is a lot of store.',
        era: 'mid',
        size: 'medium',
        target: 40_000,
        reward: purse('mid', 'medium'),
      },
    ],
    'scrap',
  ),
  ...chain('trade', 'market_sales', [
    {
      id: 'trade_1',
      name: 'First Sale',
      blurb: 'Have somebody take a listing of yours off the board.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: purse('early', 'small'),
    },
    {
      id: 'trade_2',
      name: 'A Going Concern',
      blurb: 'Fifteen sales. People check your listings first.',
      era: 'mid',
      size: 'small',
      target: 15,
      reward: purse('mid', 'small'),
    },
    {
      id: 'trade_3',
      name: 'The House Always Wins',
      blurb: 'Sixty sales off the board. You set the price now.',
      era: 'late',
      size: 'small',
      target: 60,
      reward: purse('late', 'small'),
    },
  ]),
  ...chain('buys', 'market_buys', [
    {
      id: 'buys_1',
      name: 'Buy Something',
      blurb: 'Take three deals off the board, the supplier or the Broker.',
      era: 'early',
      size: 'small',
      target: 3,
      reward: purse('early', 'small'),
    },
    {
      id: 'buys_2',
      name: 'A Standing Order',
      blurb: 'Thirty deals taken. You know what everything is worth.',
      era: 'mid',
      size: 'small',
      target: 30,
      reward: purse('mid', 'small'),
    },
  ]),
  ...chain('contraband', 'contraband_taken', [
    {
      id: 'contraband_1',
      name: 'The Back Room',
      blurb: 'Take something off the shelf behind the market. It costs a name, not caps.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: purse('early', 'small'),
    },
    {
      id: 'contraband_2',
      name: 'A Regular Back There',
      blurb: 'Fifteen takes. They keep things aside for you.',
      era: 'mid',
      size: 'medium',
      target: 15,
      reward: contraband(
        'adrenaline_syringes',
        'combat_stims',
        'banned_explosives',
        'combat_stims',
        'adrenaline_syringes',
      ),
    },
    {
      id: 'contraband_3',
      name: 'Nothing Is Not For Sale',
      blurb: 'Fifty takes out of the back room.',
      era: 'late',
      size: 'medium',
      target: 50,
      reward: kit('late', 'medium'),
    },
  ]),
];

// --- the name ---

const NAME: FeatSpec[] = [
  ...chain('infamy', 'infamy_earned', [
    {
      id: 'infamy_1',
      name: 'Heard Of',
      blurb: 'Earn a hundred infamy, ever. Spending it does not take it back.',
      era: 'early',
      size: 'medium',
      target: 100,
      reward: purse('early', 'medium'),
    },
    {
      id: 'infamy_2',
      name: 'Talked About',
      blurb: 'Two and a half thousand earned. The street has an opinion.',
      era: 'mid',
      size: 'medium',
      target: 2_500,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'infamy_3',
      name: 'A Name Like a Threat',
      blurb: 'Twenty five thousand infamy earned over a lifetime.',
      era: 'late',
      size: 'large',
      target: 25_000,
      reward: purse('late', 'large'),
    },
  ]),
  ...chain('notoriety', 'notoriety', [
    {
      id: 'notoriety_1',
      name: 'Off Nobody',
      blurb: 'Buy the first rung of the ladder. Three hundred infamy and you have a name.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: purse('early', 'medium'),
    },
    {
      id: 'notoriety_2',
      name: 'Four Rungs Up',
      blurb: 'Twelve thousand infamy sunk into a title.',
      era: 'mid',
      size: 'large',
      target: 4,
      reward: purse('mid', 'large'),
    },
    {
      id: 'notoriety_3',
      name: 'Seven',
      blurb: 'Most of a million infamy spent on being called something.',
      era: 'late',
      size: 'large',
      target: 7,
      reward: purse('late', 'large'),
    },
  ]),
  ...chain('research', 'research_done', [
    {
      id: 'research_1',
      name: 'Finish Something',
      blurb: 'Complete one programme in the Lab.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: kit('early', 'small'),
    },
    {
      id: 'research_2',
      name: 'Fifteen Programmes',
      blurb: 'The tracks start reinforcing each other around here.',
      era: 'mid',
      size: 'medium',
      target: 15,
      reward: kit('mid', 'medium'),
    },
    {
      id: 'research_3',
      name: 'Sixty',
      blurb: 'Sixty rungs finished. Whole tracks are behind you.',
      era: 'late',
      size: 'medium',
      target: 60,
      reward: kit('late', 'medium'),
    },
  ]),
  ...chain('pages', 'pages_found', [
    {
      id: 'pages_1',
      name: 'A Page',
      blurb: 'Find one page of a blueprint. They come off jobs, shelves and barrows.',
      era: 'early',
      // A page is worth 540 caps, which is over the early-small ceiling. It is a medium reward for
      // a small ask on purpose: the first page is the one that teaches a player pages exist.
      size: 'medium',
      target: 1,
      reward: leaves('pg_snipers_barrel_liners', 1),
    },
    {
      id: 'pages_2',
      name: 'Twenty Pages',
      blurb: 'Enough paper to finish something. Probably not the thing you wanted.',
      era: 'mid',
      size: 'medium',
      target: 20,
      reward: kit('mid', 'medium'),
    },
    {
      id: 'pages_3',
      name: 'Eighty Pages',
      blurb: 'A collection. Half of it is for things you will never build.',
      era: 'late',
      size: 'medium',
      target: 80,
      reward: kit('late', 'medium'),
    },
  ]),
  ...chain('blueprints', 'blueprints_unlocked', [
    {
      id: 'blueprints_1',
      name: 'Something New',
      blurb: 'Complete one blueprint and put it into the roster.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: kit('early', 'medium'),
    },
    {
      id: 'blueprints_2',
      name: 'Five Blueprints',
      blurb: 'Five things nobody could field when you started.',
      era: 'mid',
      size: 'medium',
      target: 5,
      reward: kit('mid', 'medium'),
    },
    {
      id: 'blueprints_3',
      name: 'Twelve',
      blurb: 'Twelve blueprints finished. The catalogue is yours.',
      era: 'late',
      size: 'large',
      target: 12,
      reward: kit('late', 'large'),
    },
  ]),
  ...chain('level', 'level', [
    {
      id: 'level_1',
      name: 'Level Five',
      blurb: 'The Market is open by now and the Lab is buildable.',
      era: 'early',
      size: 'small',
      target: 5,
      reward: lesson('early', 'small'),
    },
    {
      id: 'level_2',
      name: 'Level Ten',
      blurb: 'The Bar opens. You can hire somebody who knows what they are doing.',
      era: 'early',
      size: 'medium',
      target: 10,
      reward: lesson('early', 'medium'),
    },
    {
      id: 'level_3',
      name: 'Level Twenty',
      blurb: 'A hundred and fifty four thousand experience. Most of it was walking.',
      era: 'mid',
      size: 'medium',
      target: 20,
      reward: lesson('mid', 'medium'),
    },
    {
      id: 'level_4',
      name: 'Level Thirty',
      blurb: 'Half a million experience. The city treats you differently.',
      era: 'mid',
      size: 'large',
      target: 30,
      reward: lesson('mid', 'large'),
    },
    {
      id: 'level_5',
      name: 'Level Fifty',
      blurb: 'Two and a quarter million. There is not much left that is new.',
      era: 'late',
      size: 'large',
      target: 50,
      reward: lesson('late', 'large'),
    },
  ]),
];

// --- people ---

const PEOPLE: FeatSpec[] = [
  ...chain('seats', 'faction_seats', [
    {
      id: 'seats_1',
      name: 'A Table of Three',
      blurb: 'Sit at a faction with three people at it.',
      era: 'early',
      size: 'medium',
      target: 3,
      reward: purse('early', 'medium'),
    },
    {
      id: 'seats_2',
      name: 'Five Seats Filled',
      blurb: 'A full table. There is no sixth chair.',
      era: 'mid',
      size: 'medium',
      target: 5,
      reward: purse('mid', 'medium'),
    },
  ]),
  ...chain('faction', 'faction_infamy', [
    {
      id: 'faction_1',
      name: 'Under One Badge',
      blurb: 'Be at a table that has won five hundred infamy between them.',
      era: 'mid',
      size: 'medium',
      target: 500,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'faction_2',
      name: 'A Faction Worth the Name',
      blurb: 'Five thousand won under the badge you wear.',
      era: 'late',
      size: 'medium',
      target: 5_000,
      reward: purse('late', 'medium'),
    },
  ]),
  ...chain('letters', 'messages_sent', [
    {
      id: 'letters_1',
      name: 'Say Something',
      blurb: 'Write to somebody. The city is other people.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: purse('early', 'small'),
    },
    {
      id: 'letters_2',
      name: 'Correspondence',
      blurb: 'Twenty five letters out. Half of them were about ground.',
      era: 'mid',
      size: 'small',
      target: 25,
      reward: purse('mid', 'small'),
    },
  ]),
  solo(
    {
      id: 'satchel_kinds_1',
      name: 'A Full Satchel',
      blurb: 'Hold ten different sorts of thing in the satchel at once.',
      era: 'mid',
      size: 'small',
      target: 10,
      reward: kit('mid', 'small'),
    },
    'satchel_kinds',
  ),
  solo(
    {
      id: 'infamy_held_1',
      name: 'Money in the Bank',
      blurb: 'Hold five thousand infamy at once, unspent.',
      era: 'mid',
      size: 'large',
      target: 5_000,
      reward: purse('mid', 'large'),
    },
    'infamy_held',
  ),
];

/**
 * The whole catalogue, in the order the screen draws it.
 *
 * Order is load-bearing twice over. `evaluateFeats` resolves a chain in one pass and relies on a
 * step's predecessor coming first, and the screen groups by the run of entries sharing a chain, so
 * a chain split across the file would draw as two ladders. `catalog.test.ts` holds both.
 */
export const FEATS: readonly FeatSpec[] = [
  ...WORK,
  ...DISTRICT_WORK,
  ...FIGHTING,
  ...CITY,
  ...DISTRICT,
  ...CREW,
  ...TRADE,
  ...NAME,
  ...PEOPLE,
];

const BY_ID = new Map(FEATS.map((feat) => [feat.id, feat]));

export function findFeat(id: string): FeatSpec | undefined {
  return BY_ID.get(id);
}

export const FEAT_IDS: readonly string[] = FEATS.map((feat) => feat.id);
