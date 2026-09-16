import { CITY_DISTRICTS } from '../city/districts.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { markIndex } from '../crew/marks.js';
import type { FeatSpec } from './feats.js';
import type { FeatEra, FeatReward, FeatSize } from './rewards.js';
import type { FeatMeasure } from './measures.js';

/**
 * The feats (maintainer request, 2026-09-13): two hundred things to go and do.
 *
 * ## How this is built, and why it is data rather than prose
 *
 * Every entry is a measure, a target and a reward, so the whole table can be checked at once:
 * `catalog.test.ts` prices every reward against the band its era and size allow, refuses a chain
 * whose targets do not climb, refuses an id used twice, and refuses a scope that names a district
 * or a building the game does not have. A catalogue this size cannot be kept honest by reading it.
 *
 * The rewards come from the nine helpers below rather than being typed out two hundred
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
 *   * **fighting**: declared battles, units committed, ground taken;
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

const recruits = (era: FeatEra, size: FeatSize): FeatReward =>
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

/**
 * Parts, in quantities a crew can actually spend.
 *
 * This helper used to pay `rotor_hub: 100, targeting_core: 80` at the top tier, and across the
 * catalogue it handed over **376 Rotor Hubs and 256 Targeting Cores**. The whole game consumes one
 * Rotor Hub and two Targeting Cores, ever: one is the toll for Garage 12, and two are the cost of
 * the last weapons refit. It passed the band check because a reward is priced in caps-equivalent
 * and a Rotor Hub is worth 2,400 caps, so a hundred of them is a correctly-priced number of caps
 * and a meaningless number of parts. Worse, `lab_2` is a **mid-game** feat and paid four of them,
 * which is the tightest gate in the game handed over four times before a player would reach it.
 *
 * `parts.ts` says it plainly: resources are the pace of a district and parts are a gate. A gate
 * you are given a hundred keys to is not a gate. So every tier below is bounded by what the game
 * can absorb (see `LIFETIME_PART_DEMAND` in `catalog.test.ts`, which is computed off the building
 * gates and the refit table and fails this file if it drifts), and the value the band wants is
 * made up in **caps** rather than in parts nobody can spend.
 */
const kit = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { items: { scrap_servo: 2 } },
      medium: { items: { scrap_servo: 4, optic_cluster: 2 } },
      large: { items: { optic_cluster: 8, scrap_servo: 10 } },
    },
    mid: {
      small: { items: { optic_cluster: 6, scrap_servo: 4 } },
      medium: {
        ...purse('mid', 'small'),
        items: { ceramic_plate: 4, optic_cluster: 4, scrap_servo: 6 },
      },
      large: {
        ...purse('mid', 'medium'),
        items: { neural_shunt: 6, coolant_cell: 5, ceramic_plate: 10, optic_cluster: 10 },
      },
    },
    late: {
      small: {
        ...purse('mid', 'small'),
        items: { gyro_assembly: 4, optic_cluster: 8, scrap_servo: 10 },
      },
      medium: {
        ...purse('mid', 'large'),
        items: {
          targeting_core: 1,
          neural_shunt: 6,
          coolant_cell: 5,
          ceramic_plate: 12,
          optic_cluster: 12,
        },
      },
      // The one feat that finishes a crew's parts problem for good: one of everything the game
      // will ever ask for. Bounded by that and not a unit past it.
      large: {
        ...purse('late', 'large'),
        items: {
          rotor_hub: 1,
          targeting_core: 2,
          neural_shunt: 9,
          coolant_cell: 8,
          ceramic_plate: 16,
          optic_cluster: 20,
          gyro_assembly: 6,
          scrap_servo: 26,
        },
      },
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
    {
      id: 'clean_4',
      name: 'Never a Bad Season',
      blurb: 'Eight hundred clean runs. The failures are a rounding error.',
      era: 'late',
      size: 'large',
      target: 800,
      reward: lesson('late', 'large'),
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
      {
        id: 'oddjobs_4',
        name: 'Whatever Needs Doing',
        blurb: 'Two hundred and fifty odd jobs. No work is beneath this crew.',
        era: 'late',
        size: 'medium',
        target: 250,
        reward: purse('late', 'medium'),
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
).flatMap((district) => {
  const era: FeatEra =
    district.difficulty <= 2 ? 'early' : district.difficulty <= 5 ? 'mid' : 'late';
  // The second rung sits one era deeper, because fifty jobs out of one district is a season's work
  // wherever that district sits on the ladder. Clamped at `late`, which is the end of the road.
  const deeper: FeatEra = era === 'early' ? 'mid' : 'late';
  const key = `area_${district.id.replace(/-/g, '_')}`;
  return chain(
    key,
    'missions_in_area',
    [
      {
        id: key,
        name: `Ten in ${district.name}`,
        blurb: `Run ten jobs out of ${district.name}. Learn one piece of ground properly.`,
        era,
        size: 'small',
        target: 10,
        reward: purse(era, 'small'),
      },
      {
        id: `${key}_2`,
        name: `Fifty in ${district.name}`,
        blurb: `Fifty jobs out of ${district.name}. You know which doors stick.`,
        era: deeper,
        size: 'medium',
        target: 50,
        reward: purse(deeper, 'medium'),
      },
    ],
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
    {
      id: 'wins_4',
      name: 'Two Hundred Standing',
      blurb: 'Two hundred fights won. There is a version of the city where you lost one.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: spoils('late', 'large'),
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
      blurb: 'Commit fifty units to declared fights. They do not all come back.',
      era: 'early',
      size: 'small',
      target: 50,
      reward: recruits('early', 'small'),
    },
    {
      id: 'deployed_2',
      name: 'A Column',
      blurb: 'Five hundred units committed. The quartermaster has opinions.',
      era: 'mid',
      size: 'small',
      target: 500,
      reward: recruits('mid', 'small'),
    },
    {
      id: 'deployed_3',
      name: 'Numbers',
      blurb: 'Five thousand. You stopped knowing their names a long way back.',
      era: 'late',
      size: 'medium',
      target: 5_000,
      reward: recruits('late', 'medium'),
    },
  ]),
  ...chain('muster', 'supply_deployed', [
    {
      id: 'muster_1',
      name: 'A Hundred on the Ground',
      blurb: 'Field units worth a hundred unit slots across your fights.',
      era: 'early',
      size: 'medium',
      target: 100,
      reward: recruits('early', 'medium'),
    },
    {
      id: 'muster_2',
      name: 'Five Hundred',
      blurb: 'The same again, five times over. Beds are the real limit.',
      era: 'mid',
      size: 'medium',
      target: 500,
      reward: recruits('mid', 'medium'),
    },
    {
      id: 'muster_3',
      name: 'Two and a Half Thousand',
      blurb: 'Unit slots enough to empty a district. Most of them were yours.',
      era: 'late',
      size: 'large',
      target: 2_500,
      reward: recruits('late', 'large'),
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
    {
      id: 'gates_3',
      name: 'Every Door in the Wall',
      blurb: 'Fifteen gates taken. The wall is a suggestion now.',
      era: 'late',
      size: 'large',
      target: 15,
      reward: spoils('late', 'large'),
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
    {
      id: 'scouting_4',
      name: 'Nothing Unmapped',
      blurb:
        'Five hundred scouting runs. There is no corner of this city you have not looked into.',
      era: 'late',
      size: 'medium',
      target: 500,
      reward: lesson('late', 'medium'),
    },
  ]),
];

// --- the district ---

const DISTRICT: FeatSpec[] = [
  ...chain(
    'quarters',
    'building_level',
    [
      {
        id: 'quarters_1',
        name: 'Somewhere to Sleep',
        blurb: 'Quarters at three. People stop leaving because of the beds.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'quarters_2',
        name: 'A Full House',
        blurb: 'Quarters at twelve. Room for everybody you keep hiring.',
        era: 'mid',
        size: 'medium',
        target: 12,
        reward: wages('mid', 'medium'),
      },
    ],
    'quarters',
  ),
  ...chain(
    'gauntlet',
    'building_level',
    [
      {
        id: 'gauntlet_1',
        name: 'A Place to Drill',
        blurb: 'A Gauntlet at three. Units come out of it better than they went in.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'gauntlet_2',
        name: 'The Hard Yard',
        blurb: 'A Gauntlet at twelve. The drill is worse than most of the fights.',
        era: 'mid',
        size: 'medium',
        target: 12,
        reward: wages('mid', 'medium'),
      },
    ],
    'gauntlet',
  ),
  ...chain(
    'scrapyard',
    'building_level',
    [
      {
        id: 'scrapyard_1',
        name: 'Somebody Who Can Cut',
        blurb: 'A Scrapyard at three. Things get taken apart properly now.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'scrapyard_2',
        name: 'The Whole Works',
        blurb: 'A Scrapyard at twelve. There is nothing they cannot fit.',
        era: 'mid',
        size: 'medium',
        target: 12,
        reward: wages('mid', 'medium'),
      },
    ],
    'scrapyard',
  ),
  ...chain(
    'greenhouse',
    'building_level',
    [
      {
        id: 'greenhouse_1',
        name: 'Something Growing',
        blurb: 'A Greenhouse at three. The crew eats without asking the city.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'greenhouse_2',
        name: 'Fed and Watered',
        blurb: 'A Greenhouse at twelve. Nobody here has been hungry in a long time.',
        era: 'mid',
        size: 'medium',
        target: 12,
        reward: wages('mid', 'medium'),
      },
    ],
    'greenhouse',
  ),
  ...chain(
    'generator',
    'building_level',
    [
      {
        id: 'generator_1',
        name: 'The Lights Stay On',
        blurb: 'A Generator at three. The district stops going dark at night.',
        era: 'early',
        size: 'medium',
        target: 3,
        reward: wages('early', 'medium'),
      },
      {
        id: 'generator_2',
        name: 'Off the Grid Entirely',
        blurb: 'A Generator at twelve. The Combine cannot switch you off any more.',
        era: 'mid',
        size: 'medium',
        target: 12,
        reward: wages('mid', 'medium'),
      },
    ],
    'generator',
  ),
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
      {
        id: 'gate_3',
        name: 'Nothing Gets Through',
        blurb: 'A Gate at eighteen. Whatever is out there can stay out there.',
        era: 'late',
        size: 'large',
        target: 18,
        reward: wages('late', 'large'),
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
      {
        id: 'lab_3',
        name: 'The Whole Library',
        blurb: 'A Lab at sixteen. Somebody in there is ahead of the Combine.',
        era: 'late',
        size: 'large',
        target: 16,
        reward: wages('late', 'large'),
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
      {
        id: 'garage_3',
        name: 'A Yard With a Name',
        blurb: 'A Garage at sixteen. Machines come out of it that nobody else can build.',
        era: 'late',
        size: 'large',
        target: 16,
        reward: wages('late', 'large'),
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
  /*
   * The deck (maintainer request, 2026-09-14).
   *
   * Building a modification in the Scrapyard and bolting it into a slot are two different acts,
   * and `addons_built` only ever counted the first. A crew could cut eighty fittings and hang none
   * of them and the board would call it finished, which is the shape this project keeps tripping
   * over: a mechanic shipped with nothing counting it.
   *
   * Two chains because the system asks two things. Fitting is the steady one, open from the first
   * slot at level 5. A set is three slots on one structure all of one family, so it needs a
   * structure at twenty and belongs late; the targets stop at five because a sixth set is a sixth
   * building at maximum level, which is further than any other feat in the catalogue reaches.
   */
  ...chain('fittings', 'modifications_fitted', [
    {
      id: 'fittings_1',
      name: 'Bolted In',
      blurb: 'One modification in a slot. The drawing is a thing now.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: kit('early', 'small'),
    },
    {
      id: 'fittings_2',
      name: 'Every Slot Earns',
      blurb: 'Eight fitted. Nothing in the district is standing as it was built.',
      era: 'mid',
      size: 'small',
      target: 8,
      reward: kit('mid', 'small'),
    },
    {
      id: 'fittings_3',
      name: 'Rebuilt From The Inside',
      blurb: 'Twenty in their slots, and none of them coming out again.',
      era: 'late',
      size: 'medium',
      target: 20,
      reward: kit('late', 'medium'),
    },
  ]),
  ...chain('sets', 'modification_sets', [
    {
      id: 'sets_1',
      name: 'Built Around One Idea',
      blurb: 'A structure at twenty with three of a kind in it. It does one thing very well.',
      era: 'late',
      size: 'small',
      target: 1,
      reward: kit('late', 'small'),
    },
    {
      id: 'sets_2',
      name: 'A Hand, Not A Pile',
      blurb: 'Three structures each committed to a family. The district reads as a plan.',
      era: 'late',
      size: 'medium',
      target: 3,
      reward: kit('late', 'medium'),
    },
    {
      id: 'sets_3',
      name: 'Nothing Here By Accident',
      blurb: 'Five sets. Every wall of it was chosen twice.',
      era: 'late',
      size: 'large',
      target: 5,
      reward: kit('late', 'large'),
    },
  ]),
  /*
   * The unit bench (2026-09-15): thirty modification cards, three brackets a unit, one of each.
   *
   * Counted off the brackets rather than off the stock, for the reason the deck is: building a
   * card and bolting it on are two acts, and `addons_built` already counts the first. A card is
   * one object and goes on one unit, so the ceiling is the catalogue, thirty; the top rung asks for
   * two thirds of it, which is a crew that has collected most of the twenty-seven documents. The
   * masterpiece feat stands alone: the five dearest cards want a level-7 yard and a five-or-six
   * page document each, and the first one bolted on is the moment, not the fifth.
   */
  ...chain('kitted', 'unit_modifications_fitted', [
    {
      id: 'kitted_1',
      name: 'Taped Up',
      blurb: 'One card in one bracket. The squad is not standard issue any more.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: kit('early', 'small'),
    },
    {
      id: 'kitted_2',
      name: 'Three Full Racks',
      blurb: 'Nine cards bolted on. Three units built for the job they are sent to.',
      era: 'mid',
      size: 'small',
      target: 9,
      reward: kit('mid', 'small'),
    },
    {
      id: 'kitted_3',
      name: 'Nobody Standard',
      blurb: 'Twenty cards in brackets. Two thirds of everything the yard can cut, on somebody.',
      era: 'late',
      size: 'medium',
      target: 20,
      reward: kit('late', 'medium'),
    },
  ]),
  solo(
    {
      id: 'masterpiece_fitted',
      name: 'Known By Name',
      blurb: 'A masterpiece card bolted to a unit. One of these turns up a year.',
      era: 'late',
      size: 'small',
      target: 1,
      reward: kit('late', 'small'),
    },
    'masterpieces_fitted',
  ),
  ...chain('addons', 'addons_built', [
    {
      id: 'addons_1',
      name: 'Fitted Out',
      blurb: 'Three modifications, unit cards or traps out of the Scrapyard.',
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
  solo(
    {
      id: 'skills_70',
      name: 'Sharpened',
      blurb: 'Three of the Overseer\u2019s skills above seventy. Not a generalist any more.',
      era: 'late',
      size: 'medium',
      target: 3,
      reward: lesson('late', 'medium'),
    },
    'overseer_skills_at',
    '70',
  ),
  ...chain('roster', 'army_units', [
    {
      id: 'roster_1',
      name: 'Twenty at Home',
      blurb: 'Twenty units standing in your district at once.',
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
  ...chain('beds', 'army_unit_slots', [
    {
      id: 'beds_1',
      name: 'Forty Slots Full',
      blurb: 'Hold units worth forty unit slots at home. The Quarters decide how many.',
      era: 'early',
      size: 'small',
      target: 40,
      reward: purse('early', 'small'),
    },
    {
      id: 'beds_2',
      name: 'Three Hundred',
      blurb: 'Three hundred unit slots filled in your district. Most of them eat.',
      era: 'mid',
      size: 'small',
      target: 300,
      reward: purse('mid', 'small'),
    },
    {
      id: 'beds_3',
      name: 'A Thousand at Home',
      blurb: 'A thousand unit slots under your roof, all of them fed.',
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
      blurb: 'Train twenty five units, start to finish.',
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
    {
      id: 'trained_4',
      name: 'A Generation',
      blurb: 'Ten thousand units through the yard. You are where soldiers come from.',
      era: 'late',
      size: 'large',
      target: 10000,
      reward: recruits('late', 'large'),
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
    {
      id: 'vehicles_3',
      name: 'A Column of Your Own',
      blurb: 'Twenty machines built. That is not a garage, that is an industry.',
      era: 'late',
      size: 'large',
      target: 20,
      reward: kit('late', 'large'),
    },
  ]),
];

// --- the trade ---

const TRADE: FeatSpec[] = [
  solo(
    {
      id: 'earn_scrap',
      name: 'Half a Million in Scrap',
      blurb: 'Take five hundred thousand scrap out of this city, all told.',
      era: 'late',
      size: 'medium',
      target: 500_000,
      reward: purse('late', 'medium'),
    },
    'resources_earned',
    'scrap',
  ),
  solo(
    {
      id: 'earn_oil',
      name: 'Everything Burns',
      blurb: 'Two hundred thousand oil, lifetime. Something of yours is always running.',
      era: 'late',
      size: 'medium',
      target: 200_000,
      reward: purse('late', 'medium'),
    },
    'resources_earned',
    'oil',
  ),
  solo(
    {
      id: 'earn_planks',
      name: 'Timber',
      blurb: 'A hundred and fifty thousand planks. Half the district is standing on them.',
      era: 'mid',
      size: 'medium',
      target: 150_000,
      reward: purse('mid', 'medium'),
    },
    'resources_earned',
    'planks',
  ),
  solo(
    {
      id: 'hold_caps',
      name: 'Cash on Hand',
      blurb: 'Sit on a quarter of a million caps at once. Options, is what that is.',
      era: 'late',
      size: 'large',
      target: 250_000,
      reward: purse('late', 'large'),
    },
    'resources_held',
    'caps',
  ),
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
      {
        id: 'stock_3',
        /*
         * Held at once, so the ceiling is the balance constraint rather than the grind.
         *
         * This asked for 400,000 against a store that tops out at 99,032: an Apothecary at twenty
         * is 42,686, and every storage card in the game fitted across the district is a little
         * under 2.4x of that. The rung was unclaimable for the life of the account and nothing said
         * so, because a feat stuck at 23% reads exactly like one nobody has got round to.
         *
         * 75,000 wants the Apothecary near its ceiling with its three storage cards in, plus
         * storage cards in three other structures, which is a district built around its store.
         * `catalog.test.ts` holds every `resources_held` target under what a maxed district can
         * hold, so a retune of `STORAGE_GROWTH` cannot quietly put this out of reach again.
         */
        name: 'Seventy-Five Thousand Scrap',
        blurb: 'Sit on seventy-five thousand scrap. Nothing gets built without asking you.',
        era: 'late',
        size: 'large',
        target: 75_000,
        reward: purse('late', 'large'),
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
    {
      id: 'trade_4',
      name: 'The House Always Sells',
      blurb: 'Two hundred and fifty sales. The board moves when you say it moves.',
      era: 'late',
      size: 'medium',
      target: 250,
      reward: purse('late', 'medium'),
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
    {
      id: 'buys_3',
      name: 'The Best Customer',
      blurb: 'A hundred and fifty buys. The Runner keeps things back for you.',
      era: 'late',
      size: 'medium',
      target: 150,
      reward: purse('late', 'medium'),
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
    {
      id: 'contraband_4',
      name: 'A Standing Arrangement',
      blurb: 'Two hundred off the back room. They restock for you specifically.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: spoils('late', 'large'),
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
    {
      id: 'faction_3',
      name: 'A Name Spoken Carefully',
      blurb: 'Fifty thousand infamy under one badge. Nobody calls a fight on you lightly.',
      era: 'late',
      size: 'large',
      target: 50000,
      reward: street('late', 'large'),
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
    {
      id: 'letters_3',
      name: 'Everybody Knows Somebody',
      blurb: 'A hundred and fifty letters. Half the city owes you an answer.',
      era: 'late',
      size: 'small',
      target: 150,
      reward: lesson('late', 'small'),
    },
  ]),
  solo(
    {
      id: 'inventory_kinds_1',
      name: 'A Full Inventory',
      blurb: 'Hold ten different sorts of thing in the inventory at once.',
      era: 'mid',
      size: 'small',
      target: 10,
      reward: kit('mid', 'small'),
    },
    'inventory_kinds',
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
