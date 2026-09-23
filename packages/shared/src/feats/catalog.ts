import { BUILDING_KINDS } from '../building/kinds.js';
import { SYNDIC_ARMOR, SYNDIC_PENETRATION } from '../city/combine.js';
import { CITY_DISTRICTS } from '../city/districts.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { markIndex } from '../crew/marks.js';
import type { FeatSpec } from './feats.js';
import type { FeatEra, FeatReward, FeatSize } from './rewards.js';
import type { FeatMeasure } from './measures.js';

/**
 * The feats (maintainer request, 2026-09-13): nearly five hundred things to go and do.
 *
 * ## How this is built, and why it is data rather than prose
 *
 * Every entry is a measure, a target and a reward, so the whole table can be checked at once:
 * `catalog.test.ts` prices every reward against the band its era and size allow, refuses a chain
 * whose targets do not climb, refuses an id used twice, and refuses a scope that names a district
 * or a building the game does not have. A catalogue this size cannot be kept honest by reading it.
 *
 * The rewards come from the nine helpers below rather than being typed out five hundred
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
 *   * **the Combine**: the regime's units, its leaders and its ground, on a card of their own;
 *   * **the city**: scouting, holdings, whole districts, gates;
 *   * **the district**: buildings, traps, fittings, the things that are built and not won;
 *   * **the crew**: units, officers, the Overseer's own sheet;
 *   * **the trade**: caps earned over a lifetime, the market, the back room;
 *   * **the name**: infamy, notoriety, research, blueprints;
 *   * **people**: the faction and the post.
 *
 * The earliest step of most chains is an **instructor**: it asks for one of something, so that a
 * player who has never sent a scout is told that scouting exists by being paid to try it once.
 *
 * ## One ladder per group runs to tier X
 *
 * Most chains are two, three or four rungs, which is the right length for a thing with three
 * interesting sizes. The trouble with a board made only of those is that a crew six months in has
 * the top of every one of them and the screen has nothing left to say. So each of the eight groups
 * above carries one ladder of **ten**: `runs`, `kills`, `taken`, `addons`, `trained`, `caps`,
 * `infamy` and `faction`. Whatever you spend your evenings doing, there is a rung above the one you
 * are on.
 *
 * The deep rungs are deliberately far off, in the same spirit as the top of the notoriety ladder
 * (`economy/notoriety.ts`: "there to be seen from a distance"). Tier X of the work is fourteen
 * thousand jobs and nobody is finishing it this year. It is on the board so that the number exists
 * and a player can decide what they think of it. What keeps them from being a wall of shut doors is
 * the screen, not the catalogue: the board draws the rung you are on and the next one, and the
 * rungs you have collected go behind `Claimed` (`features/feats/featsList.ts`).
 */

// --- the reward helpers, priced once ---

/**
 * ## What the early bundles are made of, and why they changed (maintainer, 2026-09-18)
 *
 * The early tiers used to be caps and scrap, and scrap is the one thing the opening is not short
 * of: a new crew holds 500 of it and the Scrap Run, a three minute job, brings back 34 more. What
 * it holds none of is a faucet for **caps**, which no structure produces and which the second
 * Nexus level wants 512 of, and what runs out next is **planks** and then **oil**.
 *
 * So the two early tiers lead with caps and carry all three of the things the first evening
 * actually runs out of. They are worth about twice what they were, which the bands hold without
 * argument: a `small` early was 220 against a ceiling of 500, and `spoils` and `wages` are the
 * two helpers that stack on top of `medium`, so it stops at 1,812 rather than at the 2,180 the
 * band would allow.
 */
const purse = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { resources: { caps: 240, scrap: 40, planks: 40, oil: 20 } },
      medium: { resources: { caps: 800, scrap: 200, planks: 160, oil: 80 } },
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

/**
 * Bodies.
 *
 * The early tiers pay **Scavengers** alongside the Razors, and used to pay Haulers. Haulers moved
 * to Nexus 15 when both carriers were re-gated on the building that signs them
 * (`units/catalog.ts`), so an early feat handing them over was handing a new crew a unit it could
 * not replace for a fortnight, on a reward whose whole job is to teach what a bench is for.
 * Scavengers are one bed each and trainable from the first second, so a crew paid them can go and
 * buy more of the same.
 */
const recruits = (era: FeatEra, size: FeatSize): FeatReward =>
  ({
    early: {
      small: { units: { razors: 3, scavengers: 2 } },
      medium: { units: { razors: 14, scavengers: 10 } },
      large: { units: { razors: 30, scrapers: 12, scavengers: 20 } },
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

/**
 * What a rung above the authored ones pays: one ladder, thirteen steps (maintainer, 2026-09-16).
 *
 * A chain that climbs past four rungs runs out of reward table. `late`/`large` is the top of the
 * bands and there is nothing above it, so the natural thing (reach for the same helpers again) pays
 * 402,790 at one rung and 183,200 at the next: every gate in this file passes, because both are
 * inside their band, and the ladder asks for four times the work for half the money.
 *
 * So the deep rungs come off a single ordered ladder instead, priced as a **multiple** of the
 * biggest bundle the late band holds (`purse('late', 'large')`, 422,000 caps-equivalent). Step 0 is
 * a few per cent of it and step 12 is three and a third, which is what
 * `FEAT_REWARD_BANDS.late.large` was widened to hold. A chain joins the ladder at whatever step
 * first pays more than its last authored rung and climbs from there, which is the rule
 * `catalog.test.ts` holds as "never pays a rung less than the rung below it".
 *
 * The flavour picks the currency and not the size: every flavour at a given step is worth about the
 * same to the band check, so a ladder about killing can pay in a name and one about the yard can pay
 * in coin without either being the better rung to take.
 */
/**
 * The biggest squad a single reward may hand over, as a multiple of the base bundle below.
 *
 * Bounded by the beds the game has rather than by taste: at 1.5 the squad is 1,512 unit slots,
 * which is just under the 1,560 that `recruits('late', 'large')` has always paid and a little under
 * half of what a crew holding the whole city could house. Anything past that is a reward the
 * district has to be emptied to accept.
 */
const BODIES_CAP_TIMES = 1.5;

const RISE_MULTIPLES = [
  0.03, 0.09, 0.19, 0.28, 0.45, 0.86, 1.1, 1.35, 1.6, 1.95, 2.35, 2.8, 3.35,
] as const;

/** The size each step declares, so the band check and the ladder cannot drift apart. */
const RISE_SIZES: readonly FeatSize[] = [
  'small',
  'medium',
  'medium',
  'medium',
  'large',
  'large',
  'large',
  'large',
  'large',
  'large',
  'large',
  'large',
  'large',
];

export type DeepFlavour = 'coin' | 'blood' | 'bodies' | 'schooling';

/** The coin bundle at a given multiple, named so the `bodies` top-up cannot drift away from it. */
const coinAt = (times: number): FeatReward => ({
  resources: {
    caps: Math.round(120_000 * times),
    scrap: Math.round(50_000 * times),
    oil: Math.round(25_000 * times),
    planks: Math.round(25_000 * times),
    highQualityMetal: Math.round(6_000 * times),
  },
});

/** What step `step` of the ladder pays, in the currency the chain is about. */
const rise = (step: number, flavour: DeepFlavour): FeatReward => {
  const index = Math.min(Math.max(step, 0), RISE_MULTIPLES.length - 1);
  const times = RISE_MULTIPLES[index] ?? 1;
  switch (flavour) {
    case 'coin':
      /*
       * Rounded in `coinAt`, and the rounding is not cosmetic (bug pass, 2026-09-17).
       *
       * `50_000 * 0.28` is 14000.000000000002 in binary floating point, and nothing downstream
       * fixes it: `addResources` adds the reward straight onto the stockpile, so collecting
       * `hauls_4` left a crew holding a scrap pile with a tail of noughts and a 2 on the end of it,
       * for ever. Resources are the one reward channel whose schema allows a fraction, because
       * production settles in fractional carry, so the type system was never going to catch this
       * and `catalog.test.ts` now does.
       */
      return coinAt(times);
    case 'blood':
      return { infamy: Math.round(42_200 * times) };
    case 'bodies': {
      /*
       * A squad, bounded by the beds that exist, with the rest paid in coin (bug pass, 2026-09-17).
       *
       * Scaled straight through, tier X handed over 844 units worth **3,377 unit slots** against an
       * absolute ceiling of 3,186: a maxed Quarters plus every one of the city's sixty locations at
       * level ten, held by one crew, with no army in them. The claim route refuses a unit payout
       * the district cannot house (§A1) and leaves the feat ready, so the top rung of two ladders
       * was uncollectable for ever, and Collect-all reported it as still waiting every time it was
       * pressed. A reward nobody can take is the parts problem again in another channel: see the
       * note on `kit`, and `catalog.test.ts` for the bound this is held to.
       *
       * The squad stops at {@link BODIES_CAP_TIMES} and the value the rung still owes is made up in
       * caps, which is the same move `kit` makes when a tier wants more value than there are parts
       * worth handing over.
       */
      const squad = Math.min(times, BODIES_CAP_TIMES);
      const owed = times - squad;
      return {
        units: {
          juggernauts: Math.max(1, Math.round(105 * squad)),
          ironsides: Math.max(1, Math.round(84 * squad)),
          snipers: Math.max(1, Math.round(63 * squad)),
        },
        ...(owed > 0 ? coinAt(owed) : {}),
      };
    }
    case 'schooling':
      return { xp: Math.round(300_000 * times) };
  }
};

/** The size that goes with a step, for the author and for the band check. */
export function riseSize(step: number): FeatSize {
  return RISE_SIZES[Math.min(Math.max(step, 0), RISE_SIZES.length - 1)] ?? 'large';
}

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
    {
      id: 'runs_5',
      name: 'The Standing Order',
      blurb: 'Seven hundred and fifty jobs. The board keeps cards it only ever writes for you.',
      era: 'late',
      size: 'large',
      target: 750,
      reward: rise(7, 'schooling'),
    },
    {
      id: 'runs_6',
      name: 'Two Shifts a Day',
      blurb: 'Fourteen hundred. The trucks are never all in the yard at the same time.',
      era: 'late',
      size: 'large',
      target: 1_400,
      reward: rise(8, 'schooling'),
    },
    {
      id: 'runs_7',
      name: 'No Quiet Season',
      blurb: 'Two and a half thousand jobs, and not one week off inside any of them.',
      era: 'late',
      size: 'large',
      target: 2_500,
      reward: rise(9, 'schooling'),
    },
    {
      id: 'runs_8',
      name: 'Past Counting',
      blurb:
        'Four and a half thousand. The ledger keeper started a second book and then stopped bothering.',
      era: 'late',
      size: 'large',
      target: 4_500,
      reward: rise(10, 'schooling'),
    },
    {
      id: 'runs_9',
      name: 'Older Than the Board',
      blurb: 'Eight thousand runs. The board is younger than your route sheets.',
      era: 'late',
      size: 'large',
      target: 8_000,
      reward: rise(11, 'schooling'),
    },
    {
      id: 'runs_10',
      name: 'The Work Itself',
      blurb: 'Fourteen thousand. What this city calls work, it learned off watching you.',
      era: 'late',
      size: 'large',
      target: 14_000,
      reward: rise(12, 'schooling'),
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
    {
      id: 'clean_5',
      name: 'A Thousand Clean and More',
      blurb: 'Eighteen hundred jobs that came off. The failures fit on one page.',
      era: 'late',
      size: 'large',
      target: 1_800,
      reward: rise(6, 'schooling'),
    },
    {
      id: 'clean_6',
      name: 'The Quiet Record',
      blurb: 'Three and a half thousand clean. Nobody has asked you for references in years.',
      era: 'late',
      size: 'large',
      target: 3_500,
      reward: rise(7, 'schooling'),
    },
    {
      id: 'clean_7',
      name: 'No Bad Weeks',
      blurb: 'Six and a half thousand. Whatever went wrong, it went wrong somewhere else.',
      era: 'late',
      size: 'large',
      target: 6_500,
      reward: rise(8, 'schooling'),
    },
    {
      id: 'clean_8',
      name: 'The Firm Does Not Miss',
      blurb: 'Twelve thousand clean runs. Other crews quote your odds at their own briefings.',
      era: 'late',
      size: 'large',
      target: 12_000,
      reward: rise(9, 'schooling'),
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
      {
        id: 'raids_4',
        name: 'Four Hundred Loud Ones',
        blurb: 'Jobs where somebody was standing on it, and then was not.',
        era: 'late',
        size: 'medium',
        target: 400,
        reward: rise(2, 'blood'),
      },
      {
        id: 'raids_5',
        name: 'The Shooting Trade',
        blurb: 'Nine hundred raids. Quiet work is something other crews do.',
        era: 'late',
        size: 'medium',
        target: 900,
        reward: rise(3, 'blood'),
      },
      {
        id: 'raids_6',
        name: 'Eighteen Hundred Doors',
        blurb: 'And not one of them opened politely.',
        era: 'late',
        size: 'large',
        target: 1_800,
        reward: rise(4, 'blood'),
      },
      {
        id: 'raids_7',
        name: 'War as a Day Job',
        blurb: 'Three and a half thousand raids. The noise is the business.',
        era: 'late',
        size: 'large',
        target: 3_500,
        reward: rise(5, 'blood'),
      },
    ],
    'battle',
  ),
  /**
   * The haulage ladder opens on the second beat of the opening (maintainer, 2026-09-18).
   *
   * A new crew is handed eight Scavengers, which is enough to send one party out. This rung is
   * what using them buys: three more carriers, so a player who did the thing the game just handed
   * them the means to do comes back able to do it twice over. Three standard jobs at
   * the Scrap Run's three minutes is ten minutes of play rather than an evening.
   *
   * Caps as well as bodies, because caps are what the opening is actually short of: nothing a new
   * district produces is caps and the second Nexus level wants 512 of them.
   *
   * Prepended to the `hauls` ladder rather than stood on its own, and the reason is the screen:
   * a block's title is its measure, so a standalone feat counting standard jobs would draw as a
   * second card called "Standard missions" beside this one
   * (`features/feats/featsList.ts:ladderTitle`). The ladder is also where it belongs, since
   * haulage is what the carriers are for, and it gives this chain the instructor rung the
   * catalogue's own note says most of them should open with.
   */
  ...chain(
    'hauls',
    'missions_of_kind',
    [
      {
        id: 'first_jobs',
        name: 'Three Jobs Home',
        blurb: 'Send the crew out on three quiet jobs and get them all back. Bring bags next time.',
        era: 'early',
        size: 'small',
        target: 3,
        reward: { units: { scavengers: 3 }, resources: { caps: 200 } },
      },
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
      {
        id: 'hauls_4',
        name: 'Seven Hundred Quiet Ones',
        blurb: 'Nobody shot at any of them. That is the whole of the skill.',
        era: 'late',
        size: 'medium',
        target: 700,
        reward: rise(3, 'coin'),
      },
      {
        id: 'hauls_5',
        name: 'The Freight Line',
        blurb: 'Fifteen hundred hauls. There is a route map on the wall now.',
        era: 'late',
        size: 'large',
        target: 1_500,
        reward: rise(4, 'coin'),
      },
      {
        id: 'hauls_6',
        name: 'Everything Moves Through You',
        blurb: 'Three thousand quiet jobs. Half the city’s goods have ridden in your trucks.',
        era: 'late',
        size: 'large',
        target: 3_000,
        reward: rise(5, 'coin'),
      },
      {
        id: 'hauls_7',
        name: 'The Long Convoy',
        blurb: 'Six thousand hauls, and the trucks still go out in the morning.',
        era: 'late',
        size: 'large',
        target: 6_000,
        reward: rise(6, 'coin'),
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
      {
        id: 'oddjobs_5',
        name: 'Whatever Nobody Else Wants',
        blurb: 'Six hundred odd jobs off the bottom of the board.',
        era: 'late',
        size: 'medium',
        target: 600,
        reward: rise(3, 'coin'),
      },
      {
        id: 'oddjobs_6',
        name: 'The Board’s Best Customer',
        blurb: 'Fourteen hundred. They keep the strange ones for you now.',
        era: 'late',
        size: 'large',
        target: 1_400,
        reward: rise(4, 'coin'),
      },
      {
        id: 'oddjobs_7',
        name: 'Nothing Is Beneath the Crew',
        blurb: 'Three thousand miscellaneous jobs, and not one of them refused.',
        era: 'late',
        size: 'large',
        target: 3_000,
        reward: rise(5, 'coin'),
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
      /*
       * Two more rungs per district (maintainer, 2026-09-16), off the same row.
       *
       * Two hundred jobs out of one district is a crew that works there; six hundred is a crew the
       * district belongs to. Both are `late` whatever the district's own difficulty is, because the
       * work is the same everywhere by then and only the count separates them, and both take their
       * pay off the ladder (`rise`) so a hard district and an easy one cannot drift apart.
       */
      {
        id: `${key}_3`,
        name: `Two Hundred in ${district.name}`,
        blurb: `Two hundred jobs out of ${district.name}. The locals stopped asking who you are.`,
        era: 'late',
        size: riseSize(4),
        target: 200,
        reward: rise(4, 'coin'),
      },
      {
        id: `${key}_4`,
        name: `Six Hundred in ${district.name}`,
        blurb: `Six hundred out of ${district.name}. The place runs on your schedule.`,
        era: 'late',
        size: riseSize(5),
        target: 600,
        reward: rise(5, 'coin'),
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
    {
      id: 'fights_5',
      name: 'Five Hundred Fights',
      blurb: 'Stood in. Won or lost is a different ledger entirely.',
      era: 'late',
      size: 'large',
      target: 500,
      reward: rise(4, 'blood'),
    },
    {
      id: 'fights_6',
      name: 'Always Somewhere',
      blurb: 'Twelve hundred declared fights. There is rarely a week with none in it.',
      era: 'late',
      size: 'large',
      target: 1_200,
      reward: rise(5, 'blood'),
    },
    {
      id: 'fights_7',
      name: 'The Permanent War',
      blurb: 'Two thousand eight hundred. It stopped having a beginning.',
      era: 'late',
      size: 'large',
      target: 2_800,
      reward: rise(6, 'blood'),
    },
    {
      id: 'fights_8',
      name: 'Six Thousand Called',
      blurb: 'Fights you stood in. The city has fewer people than that.',
      era: 'late',
      size: 'large',
      target: 6_000,
      reward: rise(7, 'blood'),
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
    {
      id: 'wins_5',
      name: 'Four Hundred and Fifty Held',
      blurb: 'Won, and the ground was still yours in the morning.',
      era: 'late',
      size: 'large',
      target: 450,
      reward: rise(4, 'coin'),
    },
    {
      id: 'wins_6',
      name: 'A Thousand Wins',
      blurb: 'The losses are a footnote somebody else keeps.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: rise(5, 'coin'),
    },
    {
      id: 'wins_7',
      name: 'They Send Somebody Else',
      blurb: 'Two thousand two hundred wins. Crews take the long way round your blocks.',
      era: 'late',
      size: 'large',
      target: 2_200,
      reward: rise(6, 'coin'),
    },
    {
      id: 'wins_8',
      name: 'Nobody Left to Beat',
      blurb: 'Four and a half thousand fights won. The board runs out of names before you do.',
      era: 'late',
      size: 'large',
      target: 4_500,
      reward: rise(7, 'coin'),
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
    {
      id: 'attack_4',
      name: 'Two Hundred and Fifty Called',
      blurb: 'Fights you started, and finished.',
      era: 'late',
      size: 'large',
      target: 250,
      reward: rise(4, 'blood'),
    },
    {
      id: 'attack_5',
      name: 'Always the One Knocking',
      blurb: 'Six hundred won on somebody else’s ground.',
      era: 'late',
      size: 'large',
      target: 600,
      reward: rise(5, 'blood'),
    },
    {
      id: 'attack_6',
      name: 'The Weather Comes to Them',
      blurb: 'Fourteen hundred fights called and won.',
      era: 'late',
      size: 'large',
      target: 1_400,
      reward: rise(6, 'blood'),
    },
    {
      id: 'attack_7',
      name: 'Three Thousand Uninvited',
      blurb: 'Won on ground that belonged to somebody else when the day started.',
      era: 'late',
      size: 'large',
      target: 3_000,
      reward: rise(7, 'blood'),
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
    {
      id: 'defend_4',
      name: 'A Hundred and Fifty Held',
      blurb: 'Fights called on you that went nowhere at all.',
      era: 'late',
      size: 'large',
      target: 150,
      reward: rise(6, 'coin'),
    },
    {
      id: 'defend_5',
      name: 'The Wall',
      blurb: 'Three hundred and eighty holds. The Gate has paid for itself many times over.',
      era: 'late',
      size: 'large',
      target: 380,
      reward: rise(7, 'coin'),
    },
    {
      id: 'defend_6',
      name: 'Nobody Knocks Twice',
      blurb: 'Nine hundred holds. The city learned this one the slow way.',
      era: 'late',
      size: 'large',
      target: 900,
      reward: rise(8, 'coin'),
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
    {
      id: 'deployed_4',
      name: 'Fifteen Thousand Sent',
      blurb: 'Committed to declared fights. Most of it came back.',
      era: 'late',
      size: 'medium',
      target: 15_000,
      reward: rise(3, 'bodies'),
    },
    {
      id: 'deployed_5',
      name: 'The Levy',
      blurb: 'Forty five thousand units put on the ground, one muster at a time.',
      era: 'late',
      size: 'large',
      target: 45_000,
      reward: rise(4, 'bodies'),
    },
    {
      id: 'deployed_6',
      name: 'More Than the District Holds',
      blurb: 'A hundred and thirty thousand committed. The beds never saw most of them.',
      era: 'late',
      size: 'large',
      target: 130_000,
      reward: rise(5, 'bodies'),
    },
    {
      id: 'deployed_7',
      name: 'Everything You Ever Had',
      blurb: 'Three hundred and eighty thousand units sent out over a lifetime.',
      era: 'late',
      size: 'large',
      target: 380_000,
      reward: rise(6, 'bodies'),
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
    {
      id: 'muster_4',
      name: 'Eight Thousand Slots',
      blurb: 'Unit slots committed. Somebody had to find beds for all of it first.',
      era: 'late',
      size: 'large',
      target: 8_000,
      reward: rise(6, 'bodies'),
    },
    {
      id: 'muster_5',
      name: 'The Standing Muster',
      blurb: 'Twenty five thousand unit slots put on the ground.',
      era: 'late',
      size: 'large',
      target: 25_000,
      reward: rise(7, 'bodies'),
    },
    {
      id: 'muster_6',
      name: 'Weight, Not Numbers',
      blurb: 'Eighty thousand unit slots committed. Heavy things, mostly.',
      era: 'late',
      size: 'large',
      target: 80_000,
      reward: rise(8, 'bodies'),
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
    {
      id: 'kills_4',
      name: 'Ten Thousand Down',
      blurb: 'Twice the figure nobody wanted to say out loud the first time.',
      era: 'late',
      size: 'large',
      target: 10_000,
      reward: rise(6, 'blood'),
    },
    {
      id: 'kills_5',
      name: 'The Infirmary Stopped Asking',
      blurb: 'Twenty thousand killed in fights you stood in. Nobody takes a statement any more.',
      era: 'late',
      size: 'large',
      target: 20_000,
      reward: rise(7, 'blood'),
    },
    {
      id: 'kills_6',
      name: 'Somebody Is Writing This Down',
      blurb: 'Thirty five thousand. There are people whose whole trade is the record of it.',
      era: 'late',
      size: 'large',
      target: 35_000,
      reward: rise(8, 'blood'),
    },
    {
      id: 'kills_7',
      name: 'Sixty Thousand',
      blurb: 'Killed. There is no line of prose left that improves on the figure.',
      era: 'late',
      size: 'large',
      target: 60_000,
      reward: rise(9, 'blood'),
    },
    {
      id: 'kills_8',
      name: 'Six Figures',
      blurb: 'A hundred thousand dead in your fights. The city keeps the number and not the names.',
      era: 'late',
      size: 'large',
      target: 100_000,
      reward: rise(10, 'blood'),
    },
    {
      id: 'kills_9',
      name: 'The Long List',
      blurb: 'A hundred and seventy thousand. It is read out on a day set aside for reading it.',
      era: 'late',
      size: 'large',
      target: 170_000,
      reward: rise(11, 'blood'),
    },
    {
      id: 'kills_10',
      name: 'What the War Cost',
      blurb:
        'Two hundred and eighty thousand killed. The war is whatever it is you have been doing.',
      era: 'late',
      size: 'large',
      target: 280_000,
      reward: rise(12, 'blood'),
    },
  ]),

  /*
   * The fights worth telling somebody about (maintainer request, 2026-09-18).
   *
   * Everything above this point counts fights. These count *particular* fights: the one you had no
   * business winning, the one nobody died in, the one that was over in a round. A board made only
   * of counters rewards showing up, and showing up is the one thing a player is going to do anyway.
   *
   * The thresholds are in `feats/battle.ts` rather than here, so a blurb promising a line twice
   * your own and the settler that decides it cannot drift apart. Force is the unit slots that
   * stand in the line: see the note there for why counting bodies would make this ladder farmable
   * with Razors, and why counting a district's porters made it farmable against a warehouse.
   */
  /**
   * The top of the fight ladder (maintainer, 2026-09-23): a board deals fights by the crew's
   * level, and these two are the weights only a grown crew sees. Solo, because each is one thing
   * done once, and the Siege is the one the level-up card at 90 promised.
   */
  solo(
    {
      id: 'fight_five',
      name: 'The Heaviest Thing They Send',
      blurb: 'Win a Fight V off the board. Mostly armour, and you held it.',
      era: 'late',
      size: 'medium',
      target: 1,
      reward: kit('late', 'medium'),
    },
    'fights_won_at_tier',
    'fight_5',
  ),
  solo(
    {
      id: 'siege_held',
      name: 'A Siege Held',
      blurb: 'Win a Siege. It pays a page and parts on top of everything, and it earns this.',
      era: 'late',
      size: 'large',
      target: 1,
      reward: rise(6, 'bodies'),
    },
    'fights_won_at_tier',
    'siege',
  ),
  ...chain('odds', 'battles_won_outnumbered', [
    {
      id: 'odds_1',
      name: 'Against the Odds',
      blurb: 'Win a fight where the line facing you was twice the size of your own.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'odds_2',
      name: 'A Habit of It',
      blurb: 'Ten wins at two to one against. It stops being a story and starts being a method.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'odds_3',
      name: 'The Smaller Side',
      blurb: 'Fifty won while outnumbered. Nobody sizes you up by what you brought any more.',
      era: 'late',
      size: 'large',
      target: 50,
      reward: spoils('late', 'large'),
    },
  ]),
  ...chain('overwhelmed', 'battles_won_overwhelmed', [
    {
      id: 'overwhelmed_1',
      name: 'Four to One',
      blurb: 'Win a fight where they had four unit slots in the line for every one of yours.',
      era: 'late',
      size: 'medium',
      target: 1,
      reward: street('late', 'medium'),
    },
    {
      id: 'overwhelmed_2',
      name: 'Five Times Over',
      blurb: 'Five wins at four to one against. The first was the dice. These are not.',
      era: 'late',
      size: 'large',
      target: 5,
      reward: spoils('late', 'large'),
    },
    {
      id: 'overwhelmed_3',
      name: 'They Stopped Counting',
      blurb: 'Twenty five fights won at four to one against. Bringing numbers has stopped helping.',
      era: 'late',
      size: 'large',
      target: 25,
      reward: rise(4, 'blood'),
    },
  ]),
  ...chain('unbloodied', 'battles_won_flawless', [
    {
      id: 'unbloodied_1',
      name: 'Everybody Home',
      blurb: 'Win a fight and walk every single unit back off the field.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'unbloodied_2',
      name: 'Not a Scratch',
      blurb: 'Fifteen fights won without burying anybody. The crew has noticed.',
      era: 'late',
      size: 'medium',
      target: 15,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'unbloodied_3',
      name: 'Nobody Buried',
      blurb: 'Seventy five wins, and not one casualty across the lot of them.',
      era: 'late',
      size: 'large',
      target: 75,
      reward: rise(4, 'coin'),
    },
  ]),
  /**
   * §E: the fights the Netrunners were the reason for (maintainer, 2026-09-18).
   *
   * A jammer kills almost nobody, so every other battle ladder in this file is blind to one: a
   * crew that wins on the back of forty per cent off the enemy's armour reads on the board as a
   * crew that won. The threshold is in `feats/battle.ts` with the other four, so a blurb
   * promising a real jam and the settler that decides it cannot drift apart.
   */
  ...chain('jammed', 'battles_won_jamming', [
    {
      id: 'jammed_1',
      name: 'In Their Systems',
      blurb: 'Win a fight with your jammers deep enough in the other side to be worth bringing.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'jammed_2',
      name: 'Nothing Fired Straight',
      blurb: 'Ten wins where the other crew never found out why their plate stopped working.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'jammed_3',
      name: 'The Quiet War',
      blurb: 'Forty fights decided by people who barely fired a shot between them.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: rise(4, 'blood'),
    },
  ]),
  /**
   * §A4: the fights that were decided days before they were called (maintainer, 2026-09-18).
   *
   * A cell is the only force in the game that can be somewhere before its crew has announced
   * they want it (`sleepers.ts`), and nothing else on the board can see that it happened: the
   * Sleepers wake into an ordinary deployment and the report names them like anybody else. This
   * ladder is the one place the *setup* is counted rather than the fight.
   *
   * `battles_won_planted` needs a real enemy, unlike the jam: a cell woken onto an empty lot is
   * a walk-in, and without the clause the chain would measure how much of the map is unheld.
   */
  ...chain('planted', 'battles_won_planted', [
    {
      id: 'planted_1',
      name: 'Already Inside',
      blurb: 'Win a fight on ground you had put people on before you called it.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'planted_2',
      name: 'The Long Game',
      blurb: 'Ten fights that were over before anybody knew they had started.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'planted_3',
      name: 'Nobody Saw Them Arrive',
      blurb: 'Thirty. The city has stopped being able to tell where your people are.',
      era: 'late',
      size: 'large',
      target: 30,
      reward: rise(4, 'blood'),
    },
  ]),
  /**
   * §A5: the Anodics, and the fights won inside the racket they brought (2026-09-19).
   *
   * `loud` is the only rule in the game whose weapon is the *ground*: the label goes onto the
   * other side's reading of the battlefield and what it costs them is decided by their own
   * sheets, so a crew that brings Anodics against something that hunts by ear has done something
   * a report will never quite name. This is the one place it is counted.
   *
   * Shallower than the cell's ladder and starting earlier, because Anodics are rabble behind a
   * level-two Scrapyard rather than a specialist behind a location: bringing some is an early
   * decision, and the chain should be climbable by a crew making it.
   */
  ...chain('loud', 'battles_won_loud', [
    {
      id: 'loud_1',
      name: 'Bring the Noise',
      blurb: 'Win a fight with Anodics in the line, on ground they made unlistenable.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: street('early', 'small'),
    },
    {
      id: 'loud_2',
      name: 'Nobody Heard the Order',
      blurb: 'Fifteen. Whole crews have walked into your racket and lost track of each other.',
      era: 'mid',
      size: 'medium',
      target: 15,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'loud_3',
      name: 'The Din',
      blurb: 'Sixty fights decided by how loud you were willing to be.',
      era: 'late',
      size: 'large',
      target: 60,
      reward: rise(4, 'blood'),
    },
  ]),
  ...chain('routs', 'battles_won_lopsided', [
    {
      id: 'routs_1',
      name: 'Ten for One',
      blurb: 'Win a fight killing ten of theirs for every one of yours, and at least ten.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'routs_2',
      name: 'One Sided',
      blurb: 'Twenty fights over before the other crew worked out what they had walked into.',
      era: 'late',
      size: 'medium',
      target: 20,
      reward: street('late', 'medium'),
    },
    {
      id: 'routs_3',
      name: 'A Bad Trade to Take',
      blurb: 'A hundred routs. The arithmetic of fighting you is public, and it is ugly.',
      era: 'late',
      size: 'large',
      target: 100,
      reward: spoils('late', 'large'),
    },
  ]),
  ...chain('sacked', 'districts_raided', [
    {
      id: 'sacked_1',
      name: 'Inside the Wall',
      blurb: 'Break into a district somebody lives in and come back out with their stock.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'sacked_2',
      name: 'Ten Doors In',
      blurb: 'Ten districts broken into. Those roofs take weeks to come back.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: purse('late', 'medium'),
    },
    {
      id: 'sacked_3',
      name: 'The Sacking Season',
      blurb: 'Forty break-ins. There are districts that budget for you now.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: rise(4, 'coin'),
    },
  ]),
  ...chain('repelled', 'raids_repelled', [
    {
      id: 'repelled_1',
      name: 'Not Today',
      blurb: 'Turn back a break-in on the district you live in.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'repelled_2',
      name: 'The Door Holds',
      blurb: 'Ten raids on your own roofs, and ten crews sent home with nothing.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'repelled_3',
      name: 'The District Holds',
      blurb: 'Forty break-ins called on your district, every one of them stopped at the gate.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: rise(4, 'blood'),
    },
  ]),
  ...chain('snares', 'trap_kills', [
    {
      id: 'snares_1',
      name: 'Before They Knew',
      blurb: 'Twenty five units taken by your traps before a shot was fired at anybody.',
      era: 'mid',
      size: 'small',
      target: 25,
      reward: purse('mid', 'small'),
    },
    {
      id: 'snares_2',
      name: 'The Ground Is Wired',
      blurb: 'Five hundred killed by things buried under the approach.',
      era: 'late',
      size: 'medium',
      target: 500,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'snares_3',
      name: 'Nothing Walks In Clean',
      blurb: 'Five thousand taken by traps. Columns slow right down two blocks out.',
      era: 'late',
      size: 'large',
      target: 5_000,
      reward: rise(4, 'blood'),
    },
  ]),
  ...chain('ring', 'runners_caught', [
    {
      id: 'ring_1',
      name: 'Nowhere to Run',
      blurb: 'Stop ten beaten runners on their way out with a ring of your own.',
      era: 'late',
      size: 'small',
      target: 10,
      reward: purse('late', 'small'),
    },
    {
      id: 'ring_2',
      name: 'The Ring Holds',
      blurb: 'Two hundred and fifty runners cut off. Losing to you is expensive twice over.',
      era: 'late',
      size: 'medium',
      target: 250,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'ring_3',
      name: 'No Way Back',
      blurb: 'Two and a half thousand caught leaving. Nobody gets home to tell it.',
      era: 'late',
      size: 'large',
      target: 2_500,
      reward: spoils('late', 'large'),
    },
  ]),
];

// --- the Combine ---

/**
 * The Combine (maintainer, 2026-09-19): the regime that holds the city, on its own card.
 *
 * Six of the eight contested districts are the Combine's and the theme of the whole map is that
 * it has been taken (`city/combine.ts`). Every ladder in the fighting section is blind to that:
 * `kills` does not know whether the dead were looters or Greycoats, and `taken` counts a plot
 * off another crew the same as one off the regime. So a crew that spent a month working its way
 * up from the Docks to the Spire read on the board as a crew that had fought a lot. The measures
 * here are tallied at the settle of any fight whose defender was the regime
 * (`apps/server/src/feats/tally.ts`, `tallyCombineFight`), and nothing else moves them.
 *
 * ## One ladder per uniform
 *
 * The four common units are the ladder the city is built as: the conscript Levy on the cheapest
 * ground, the Greycoats behind them as the difficulty rises, the Enforcers from the Annexes, the
 * Suppressors on the Blacksite (`combineGarrison`). A ladder per unit is therefore a ladder up
 * the map, and the eras follow it: nobody meets a Suppressor early. The targets are sized to the
 * numbers each one turns up in, which is why the Levy's rungs are ten times the Suppressor's.
 *
 * ## The three leaders are standalones
 *
 * The Syndic, the Executioner and Directive Xero each die once, for the whole world, and are never
 * replaced. `combine_leaders_slain` under any one of their ids can never reach two, so a ladder on
 * it would be a ladder with one rung; these are `solo` for the same reason `overseer_taken` is.
 * They pay at the top of the late band because each one is the end of a district, and the Chapel,
 * which is Directive Xero's own plot, has a feat of its own for being held afterwards.
 *
 * ## The two crew measures
 *
 * `combine_districts_held` and `chapel_held` are read off the control map rather than tallied,
 * for the reason every holding measure is: ground can be taken back, and a feat that asked "have
 * you ever" would stay lit over a district the regime has walked back into. Six is the whole of
 * the Combine's ground, which is why the ladder ends there and `catalog.test.ts` bounds it there.
 *
 * ## The turncoats
 *
 * `units_turned` is the one ladder in the catalogue that counts something that happened *to* the
 * crew. Directive Xero's Change of Heart takes the units that would have been intimidated and keeps
 * them, and the board would otherwise say nothing about it at all. It pays in experience, which
 * is what a lost squad is worth, and the blurbs do not pretend it was a good day.
 */
const COMBINE: FeatSpec[] = [
  ...chain('regime', 'combine_kills', [
    {
      id: 'regime_1',
      name: 'The First Ten',
      blurb: 'Ten of the Combine down. Levy, most likely, on the Docks. The regime has a face now.',
      era: 'early',
      size: 'small',
      target: 10,
      reward: street('early', 'small'),
    },
    {
      id: 'regime_2',
      name: 'A Hundred in Grey',
      blurb:
        'A hundred of the regime killed in your fights. Their replacements have a number and orders.',
      era: 'mid',
      size: 'small',
      target: 100,
      reward: spoils('mid', 'small'),
    },
    {
      id: 'regime_3',
      name: 'A Bad Quarter for the Ministry',
      blurb:
        'Five hundred dead in the Combine’s own ledger, all of them yours. Somebody upstairs has noticed.',
      era: 'mid',
      size: 'medium',
      target: 500,
      reward: street('mid', 'medium'),
    },
    {
      id: 'regime_4',
      name: 'Two Thousand Uniforms',
      blurb: 'Two thousand of the regime killed. The Blacksite drill square has gaps in the ranks.',
      era: 'late',
      size: 'medium',
      target: 2_000,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'regime_5',
      name: 'The Conscription Notices',
      blurb:
        'Six thousand of the Combine dead. The Levy is being raised from streets that used to be exempt.',
      era: 'late',
      size: 'large',
      target: 6_000,
      reward: street('late', 'large'),
    },
    {
      id: 'regime_6',
      name: 'What the Spire Cannot Replace',
      blurb:
        'Fifteen thousand of the regime killed in your fights. There is no district left that can spare them.',
      era: 'late',
      size: 'large',
      target: 15_000,
      reward: rise(6, 'blood'),
    },
  ]),
  ...chain(
    'levy',
    'combine_kills_of',
    [
      {
        id: 'levy_1',
        name: 'Fortnight of Drill',
        blurb:
          'Twenty five conscripts of the Civic Levy killed. A surplus blade and two weeks of training each.',
        era: 'early',
        size: 'small',
        target: 25,
        reward: purse('early', 'small'),
      },
      {
        id: 'levy_2',
        name: 'Every Street Corner',
        blurb:
          'Two hundred and fifty Levy down. They are on every corner because there are so many of them.',
        era: 'mid',
        size: 'small',
        target: 250,
        reward: purse('mid', 'small'),
      },
      {
        id: 'levy_3',
        name: 'The Quota',
        blurb:
          'A thousand conscripts killed. The Combine calls that a quarter’s intake and raises another.',
        era: 'mid',
        size: 'medium',
        target: 1_000,
        reward: spoils('mid', 'medium'),
      },
      {
        id: 'levy_4',
        name: 'Nobody Left to Conscript',
        blurb:
          'Four thousand of the Levy dead in your fights. The notices go up and the streets stay empty.',
        era: 'late',
        size: 'medium',
        target: 4_000,
        reward: spoils('late', 'medium'),
      },
    ],
    'civic_levy',
  ),
  ...chain(
    'greycoats',
    'combine_kills_of',
    [
      {
        id: 'greycoats_1',
        name: 'A Rifle and a Number',
        blurb:
          'Twenty Greycoats killed. Government infantry, named for the coat, ordered to hold whatever they stood on.',
        era: 'early',
        size: 'medium',
        target: 20,
        reward: street('early', 'medium'),
      },
      {
        id: 'greycoats_2',
        name: 'The Coats Come Off',
        blurb: 'Two hundred Greycoats down. The Steelbelt is full of grey cloth nobody claims.',
        era: 'mid',
        size: 'small',
        target: 200,
        reward: spoils('mid', 'small'),
      },
      {
        id: 'greycoats_3',
        name: 'A Rifle Company, Twice',
        blurb: 'Eight hundred Greycoats killed in your fights. The dug-in ones die where they dug.',
        era: 'mid',
        size: 'large',
        target: 800,
        reward: street('mid', 'large'),
      },
      {
        id: 'greycoats_4',
        name: 'Three Thousand Helmets',
        blurb:
          'Three thousand of the grey infantry dead. The Combine has stopped issuing the number, only the coat.',
        era: 'late',
        size: 'large',
        target: 3_000,
        reward: spoils('late', 'large'),
      },
    ],
    'greycoat',
  ),
  ...chain(
    'enforcers',
    'combine_kills_of',
    [
      {
        id: 'enforcers_1',
        name: 'The Batons Were Not for Show',
        blurb:
          'Ten Street Enforcers killed. Police infantry, more plate than a Greycoat and less patience.',
        era: 'mid',
        size: 'small',
        target: 10,
        reward: purse('mid', 'small'),
      },
      {
        id: 'enforcers_2',
        name: 'Nobody Is Being Arrested',
        blurb:
          'A hundred Enforcers down. What they carried into the Annexes for raids is in your stash now.',
        era: 'mid',
        size: 'medium',
        target: 100,
        reward: contraband('combat_stims', 'adrenaline_syringes', 'banned_explosives'),
      },
      {
        id: 'enforcers_3',
        name: 'The Raids Stop',
        blurb:
          'Four hundred Street Enforcers killed. There are streets the Combine no longer polices on foot.',
        era: 'late',
        size: 'medium',
        target: 400,
        reward: spoils('late', 'medium'),
      },
      {
        id: 'enforcers_4',
        name: 'The Plate Did Not Help',
        blurb:
          'Fifteen hundred Enforcers dead in your fights. Thirty points of armour, and none of it counted.',
        era: 'late',
        size: 'large',
        target: 1_500,
        reward: rise(5, 'blood'),
      },
    ],
    'street_enforcers',
  ),
  ...chain(
    'suppressors',
    'combine_kills_of',
    [
      {
        id: 'suppressors_1',
        name: 'The Street Is Open',
        blurb:
          'Five Suppressor crews killed. A tripod, a belt and a closed street, and you crossed it anyway.',
        era: 'mid',
        size: 'small',
        target: 5,
        // The answer to a tripod is a bigger gun: pages of the Juggernaut's mount, which is
        // the one sheet in the catalogue about out-shooting a Suppressor rather than out-running it.
        reward: leaves('pg_juggernauts_gun_mount', 2),
      },
      {
        id: 'suppressors_2',
        name: 'Fifty Tripods',
        blurb:
          'Fifty Suppressors down. The Blacksite issues them to the berms and you keep bringing them back in pieces.',
        era: 'late',
        size: 'medium',
        target: 50,
        reward: kit('late', 'medium'),
      },
      {
        id: 'suppressors_3',
        name: 'Nothing Left to Deny',
        blurb:
          'Two hundred and fifty Suppressor crews killed. Area denial needs an area, and you hold it.',
        era: 'late',
        size: 'large',
        target: 250,
        reward: rise(6, 'coin'),
      },
    ],
    'suppressor',
  ),
  ...chain('liberated', 'combine_locations_taken', [
    {
      id: 'liberated_1',
      name: 'Off the Regime',
      blurb:
        'Take one location off the Combine. The Tideline Market is the closest and the cheapest.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: spoils('early', 'medium'),
    },
    {
      id: 'liberated_2',
      name: 'Five Doors the Combine Lost',
      blurb: 'Five plots taken off the regime. The Docks and the Belt are where they come easiest.',
      era: 'mid',
      size: 'medium',
      target: 5,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'liberated_3',
      name: 'Up the Hill',
      blurb: 'Twelve Combine holdings taken. You are past the Green Belt and the ground is harder.',
      era: 'late',
      size: 'medium',
      target: 12,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'liberated_4',
      name: 'The Annexes Answer to You',
      blurb:
        'Twenty five locations taken off the regime, retakes included. Whole districts have changed their signage.',
      era: 'late',
      size: 'large',
      target: 25,
      reward: spoils('late', 'large'),
    },
    {
      id: 'liberated_5',
      name: 'Every Plot on the Climb',
      blurb: 'Fifty Combine holdings taken, counting every one they took back and you took again.',
      era: 'late',
      size: 'large',
      target: 50,
      reward: rise(7, 'coin'),
    },
  ]),
  ...chain('pushback', 'combine_fights_won', [
    {
      id: 'pushback_1',
      name: 'Against the Uniform',
      blurb:
        'Win a fight against the Combine. Anybody in the city can lose one; this is the other thing.',
      era: 'early',
      size: 'medium',
      target: 1,
      reward: spoils('early', 'medium'),
    },
    {
      id: 'pushback_2',
      name: 'Ten Over the Regime',
      blurb: 'Ten fights won against the Combine. The Levy on the Docks flinches at your colours.',
      era: 'mid',
      size: 'medium',
      target: 10,
      reward: spoils('mid', 'medium'),
    },
    {
      id: 'pushback_3',
      name: 'A Standing Problem',
      blurb:
        'Forty wins over the regime. There is a file on you in the Annexes and it has a second volume.',
      era: 'late',
      size: 'medium',
      target: 40,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'pushback_4',
      name: 'The Blacksite Takes Notes',
      blurb:
        'A hundred and twenty fights won against the Combine. The rifle company drills against your formations now.',
      era: 'late',
      size: 'large',
      target: 120,
      reward: street('late', 'large'),
    },
    {
      id: 'pushback_5',
      name: 'The Only Uniform Saluted',
      blurb:
        'Three hundred wins over the regime. There are streets where yours is the only uniform that gets saluted.',
      era: 'late',
      size: 'large',
      target: 300,
      reward: rise(6, 'blood'),
    },
  ]),
  ...chain('clean_sweep', 'combine_fights_won_flawless', [
    {
      id: 'clean_sweep_1',
      name: 'Not One of Ours',
      blurb:
        'Beat the Combine and bring every unit home. The Suppressors are supposed to make that impossible.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'clean_sweep_2',
      name: 'Ten Clean Against the Regime',
      blurb:
        'Ten fights won over the Combine without burying anybody. The Infirmary has a quiet week.',
      era: 'late',
      size: 'medium',
      target: 10,
      reward: spoils('late', 'medium'),
    },
    {
      id: 'clean_sweep_3',
      name: 'The Berms Were Empty',
      blurb: 'Forty flawless wins against the regime. Their area denial denied nothing.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: street('late', 'large'),
    },
    {
      id: 'clean_sweep_4',
      name: 'The Combine Buries, You Do Not',
      blurb:
        'A hundred and twenty fights won against the regime with every unit walked back off the field.',
      era: 'late',
      size: 'large',
      target: 120,
      reward: rise(6, 'coin'),
    },
  ]),
  /**
   * Won while the district's legendary still lived, so under his power: Standing Orders on every
   * Combine sheet in the Annexes, the Executioner finishing anybody under a tenth of a life,
   * Directive Xero's line at a hundred morale. It is decided at the settle from the same control
   * rows the engine reads (`combinePresenceOver`), so a fight after the leader has fallen counts
   * for `pushback` only.
   *
   * The figures come off `city/combine.ts` rather than being typed out, because the retune of
   * 2026-09-20 left two of these blurbs describing a power the game no longer had: twenty points
   * off the player's armour, and a morale bonus that had gone to Directive Xero. A number written
   * into copy is a number nothing moves when the mechanic moves.
   */
  ...chain('shadow', 'combine_fights_won_shadowed', [
    {
      id: 'shadow_1',
      name: 'Under His Eye',
      blurb:
        'Win a fight in a district whose Combine legendary was still standing when you won it.',
      era: 'mid',
      size: 'medium',
      target: 1,
      reward: street('mid', 'medium'),
    },
    {
      id: 'shadow_2',
      name: 'Ten in His Shadow',
      blurb: `Ten fights won under a living leader’s power. Standing Orders put +${SYNDIC_PENETRATION} penetration and +${SYNDIC_ARMOR} armour on the line facing you, and you won anyway.`,
      era: 'late',
      size: 'medium',
      target: 10,
      reward: street('late', 'medium'),
    },
    {
      id: 'shadow_3',
      name: 'Where the Executioner Walks',
      blurb:
        'Thirty wins in a district its legendary still commands. Anybody left under a tenth of a life dies, and you brought that into the plan.',
      era: 'late',
      size: 'large',
      target: 30,
      reward: spoils('late', 'large'),
    },
    {
      id: 'shadow_4',
      name: 'A Hundred Morale Means Nothing',
      blurb:
        'Seventy five fights won under a leader’s power. The Combine’s line cannot be intimidated, and it can still be broken.',
      era: 'late',
      size: 'large',
      target: 75,
      reward: rise(8, 'blood'),
    },
  ]),
  /**
   * Breaking them, not killing them (maintainer, 2026-09-23): a rout pays half a kill's infamy,
   * so a crew built on intimidation earns a name too. Counted off the engine's `fled`, in fights
   * and on battle jobs alike.
   */
  ...chain('broken', 'units_routed', [
    {
      id: 'broken_1',
      name: 'They Ran',
      blurb: 'Twenty enemy units broke and ran from a fight you were in. Half a name each.',
      era: 'early',
      size: 'small',
      target: 20,
      reward: street('early', 'small'),
    },
    {
      id: 'broken_2',
      name: 'Nobody Stays For It',
      blurb: 'Two hundred made to run. The other side breaks before the line does.',
      era: 'mid',
      size: 'medium',
      target: 200,
      reward: street('mid', 'medium'),
    },
    {
      id: 'broken_3',
      name: 'The Sound Of Your Name',
      blurb: 'A thousand routed. They run when they hear who is coming.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: street('late', 'large'),
    },
  ]),
  ...chain('turncoats', 'units_turned', [
    {
      id: 'turncoats_1',
      name: 'One of Yours Stayed',
      blurb:
        'Lose a unit to Directive Xero’s Change of Heart. They would have run; instead they crossed the line and stood with him.',
      era: 'late',
      size: 'small',
      target: 1,
      reward: lesson('late', 'small'),
    },
    {
      id: 'turncoats_2',
      name: 'The Roll Call Is Shorter',
      blurb:
        'Twenty five of your units have gone over to the Combine in the CCS. You paid for every one of them, and you will fight every one of them.',
      era: 'late',
      size: 'medium',
      target: 25,
      reward: lesson('late', 'medium'),
    },
    {
      id: 'turncoats_3',
      name: 'They Wear Grey Now',
      blurb:
        'A hundred and fifty of your people changed sides under the Chapel. Their names are still on your ledger. Their faces are on the other side of the line.',
      era: 'late',
      size: 'large',
      target: 150,
      reward: lesson('late', 'large'),
    },
  ]),
  ...chain('annexed', 'combine_districts_held', [
    {
      id: 'annexed_1',
      name: 'A District the Regime Lost',
      blurb:
        'Hold every location in a district that was the Combine’s. The Docks are the first anyone manages.',
      era: 'mid',
      size: 'large',
      target: 1,
      reward: wages('mid', 'large'),
    },
    {
      id: 'annexed_2',
      name: 'Half Their Map',
      blurb: 'Three of the six Combine districts held whole, at the same time, in your name.',
      era: 'late',
      size: 'large',
      target: 3,
      reward: wages('late', 'large'),
    },
    {
      id: 'annexed_3',
      name: 'The Regime Holds Nothing',
      blurb:
        'All six Combine districts held whole at once: Docks, Belt, Green Belt, Annexes, Blacksite and the Spire.',
      era: 'late',
      size: 'large',
      target: 6,
      reward: rise(8, 'coin'),
    },
  ]),
  solo(
    {
      id: 'syndic_slain',
      name: 'The Liaison Is Dead',
      blurb: `Kill the Syndic on the Annexe Uplink. Every yard in the Annexes fights without Standing Orders from then on: no +${SYNDIC_PENETRATION} penetration, no +${SYNDIC_ARMOR} armour.`,
      era: 'late',
      size: 'large',
      target: 1,
      // The Annexes are the factories: one of everything the game will ever ask for in parts.
      reward: kit('late', 'large'),
    },
    'combine_leaders_slain',
    'syndic',
  ),
  solo(
    {
      id: 'executioner_slain',
      name: 'Arrests Resume',
      blurb:
        'Kill the Executioner at the Blacksite Armory. Nobody on the Blacksite is finished off where they stand again.',
      era: 'late',
      size: 'large',
      target: 1,
      reward: rise(6, 'bodies'),
    },
    'combine_leaders_slain',
    'executioner',
  ),
  solo(
    {
      id: 'directive_xero_slain',
      name: 'The Chapel Is Quiet',
      blurb:
        'Kill Directive Xero in the Chosen Chapel. The Combine, in one person, carried out; nobody changes sides for him again.',
      era: 'late',
      size: 'large',
      target: 1,
      reward: rise(8, 'blood'),
    },
    'combine_leaders_slain',
    'directive_xero',
  ),
  solo(
    {
      id: 'chapel_held',
      name: 'Whose Chapel It Is',
      blurb:
        'Hold the Chosen Chapel at the top of the city. The regime’s headquarters, with your colours on the door.',
      era: 'late',
      size: 'large',
      target: 1,
      reward: rise(5, 'coin'),
    },
    'chapel_held',
  ),
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
    {
      id: 'holdings_4',
      name: 'Thirty Addresses',
      blurb: 'Held at once. The rent collector needs a second book.',
      era: 'late',
      size: 'large',
      target: 30,
      reward: rise(7, 'coin'),
    },
    {
      id: 'holdings_5',
      name: 'Half the City on Paper',
      blurb: 'Forty five holdings at the same time, all of them yours to lose.',
      era: 'late',
      size: 'large',
      target: 45,
      reward: rise(8, 'coin'),
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
    {
      id: 'taken_4',
      name: 'Ninety Doors',
      blurb: 'Ninety places taken off whoever happened to be standing in them.',
      era: 'late',
      size: 'large',
      target: 90,
      reward: rise(6, 'coin'),
    },
    {
      id: 'taken_5',
      name: 'Two Hundred Addresses',
      blurb: 'The map is redrawn oftener than anybody can print it.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: rise(7, 'coin'),
    },
    {
      id: 'taken_6',
      name: 'The Landlord',
      blurb: 'Four hundred and fifty captures. Everyone in this quarter is renting from somebody.',
      era: 'late',
      size: 'large',
      target: 450,
      reward: rise(8, 'coin'),
    },
    {
      id: 'taken_7',
      name: 'A Thousand Changes of Hands',
      blurb: 'A thousand. Half the city has been yours at some point this month.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: rise(9, 'coin'),
    },
    {
      id: 'taken_8',
      name: 'Nothing Stays Theirs',
      blurb: 'Two thousand two hundred captures, and not one of them permanent for the other side.',
      era: 'late',
      size: 'large',
      target: 2_200,
      reward: rise(10, 'coin'),
    },
    {
      id: 'taken_9',
      name: 'The City Moves Under You',
      blurb: 'Four thousand eight hundred taken. The map is a thing you do, not a thing you read.',
      era: 'late',
      size: 'large',
      target: 4_800,
      reward: rise(11, 'coin'),
    },
    {
      id: 'taken_10',
      name: 'Ten Thousand Times Theirs',
      blurb: 'Ten thousand captures. There is no ground here you have not stood on as its owner.',
      era: 'late',
      size: 'large',
      target: 10_000,
      reward: rise(12, 'coin'),
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
    {
      id: 'whole_4',
      name: 'Eight Districts Whole',
      blurb: 'Held entire, corner to corner, at the same time.',
      era: 'late',
      size: 'large',
      target: 8,
      reward: rise(7, 'coin'),
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
    {
      id: 'gates_4',
      name: 'Forty Gates',
      blurb: 'Taken off whoever was collecting at them.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: rise(4, 'coin'),
    },
    {
      id: 'gates_5',
      name: 'The Tollkeeper',
      blurb: 'A hundred gates captured. Nobody moves in this city for free.',
      era: 'late',
      size: 'large',
      target: 100,
      reward: rise(5, 'coin'),
    },
    {
      id: 'gates_6',
      name: 'Every Road In',
      blurb: 'Two hundred and fifty gates taken. The map has your hand on its throat.',
      era: 'late',
      size: 'large',
      target: 250,
      reward: rise(6, 'coin'),
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
      blurb: 'Every district but your own walked. There is nothing on that map you have not seen.',
      era: 'mid',
      size: 'medium',
      /*
       * Every district a crew can send anybody to, which is one short of the map.
       *
       * `sendScout` refuses the crew's own district outright (`own_district`), and nothing else
       * ever writes a `district_intel` row for where you live, so `districts_scouted` tops out at
       * eleven of twelve. This asked for twelve and sat at 11/12 for ever: the `stock_3` failure
       * again, where a feat nobody can finish is indistinguishable from one nobody has got round
       * to. Derived rather than typed, so a thirteenth district moves the rung with it.
       */
      target: CITY_DISTRICTS.length - 1,
      reward: lesson('mid', 'medium'),
    },
  ]),
  /*
   * Spying (maintainer, 2026-09-22). A report that stood: one under the floor is caps spent and
   * nothing learnt, and the ladder counts what was learnt. Early on a looter camp at Loose Ears is
   * the first rung; the deep rungs are a crew that reads the city rather than walks it.
   */
  ...chain('spying', 'spy_reports', [
    {
      id: 'spying_1',
      name: 'Loose Ears',
      blurb: 'Three spy reports. A drink bought for the right person, three times over.',
      era: 'early',
      size: 'small',
      target: 3,
      reward: kit('early', 'small'),
    },
    {
      id: 'spying_2',
      name: 'Somebody on the Inside',
      blurb: 'Twenty reports. Nothing stands on ground near you that you have not had counted.',
      era: 'mid',
      size: 'small',
      target: 20,
      reward: kit('mid', 'small'),
    },
    {
      id: 'spying_3',
      name: 'The Whole Wire',
      blurb: 'Eighty reports. There is no garrison in this city you would have to guess at.',
      era: 'late',
      size: 'small',
      target: 80,
      reward: kit('late', 'small'),
    },
    {
      id: 'spying_4',
      name: 'Total Intelligence',
      blurb: 'Two hundred and fifty reports. The city reads like your own books.',
      era: 'late',
      size: 'medium',
      target: 250,
      reward: lesson('late', 'medium'),
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
    {
      id: 'scouting_5',
      name: 'Twelve Hundred Walks',
      blurb: 'Scouts out and back. Somebody has drawn all of it.',
      era: 'late',
      size: 'medium',
      target: 1_200,
      reward: rise(2, 'schooling'),
    },
    {
      id: 'scouting_6',
      name: 'The Standing Map',
      blurb: 'Two thousand eight hundred runs. Nothing in this city surprises you.',
      era: 'late',
      size: 'medium',
      target: 2_800,
      reward: rise(3, 'schooling'),
    },
    {
      id: 'scouting_7',
      name: 'Eyes Everywhere',
      blurb: 'Six and a half thousand scouting runs, and they keep going out.',
      era: 'late',
      size: 'large',
      target: 6_500,
      reward: rise(4, 'schooling'),
    },
    {
      id: 'scouting_8',
      name: 'You Knew Before They Did',
      blurb: 'Fifteen thousand runs. The news reaches you on its way to being news.',
      era: 'late',
      size: 'large',
      target: 15_000,
      reward: rise(5, 'schooling'),
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
      {
        id: 'quarters_3',
        name: 'Bunks to the Roof',
        blurb: 'Quarters at seventeen. The beds go up rather than out now.',
        era: 'late',
        size: 'medium',
        target: 17,
        reward: rise(1, 'coin'),
      },
      {
        id: 'quarters_4',
        name: 'Quarters, Finished',
        blurb: 'Twenty. There is no more room in this district to give anybody.',
        era: 'late',
        size: 'medium',
        target: 20,
        reward: rise(2, 'coin'),
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
      {
        id: 'gauntlet_3',
        name: 'The Gauntlet Grinds',
        blurb: 'Seventeen levels of it. Nobody comes out of there the shape they went in.',
        era: 'late',
        size: 'medium',
        target: 17,
        reward: rise(1, 'coin'),
      },
      {
        id: 'gauntlet_4',
        name: 'The Gauntlet, Finished',
        blurb: 'Twenty. There is nothing left in that building to be taught.',
        era: 'late',
        size: 'medium',
        target: 20,
        reward: rise(2, 'coin'),
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
      {
        id: 'scrapyard_3',
        name: 'The Yard Runs Deep',
        blurb: 'Seventeen levels of bench, press and cutting torch.',
        era: 'late',
        size: 'medium',
        target: 17,
        reward: rise(1, 'coin'),
      },
      {
        id: 'scrapyard_4',
        name: 'The Yard, Finished',
        blurb: 'Twenty. Every card the game has ever printed can be cut here.',
        era: 'late',
        size: 'medium',
        target: 20,
        reward: rise(2, 'coin'),
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
      {
        id: 'greenhouse_3',
        name: 'Glass to the Sky',
        blurb: 'Seventeen levels of it, and the lamps never go off.',
        era: 'late',
        size: 'medium',
        target: 17,
        reward: rise(1, 'coin'),
      },
      {
        id: 'greenhouse_4',
        name: 'The Greenhouse, Finished',
        blurb: 'Twenty. Nothing in this district goes hungry again.',
        era: 'late',
        size: 'medium',
        target: 20,
        reward: rise(2, 'coin'),
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
      {
        id: 'generator_3',
        name: 'Seventeen Levels of Power',
        blurb: 'The lights in this district do not flicker any more.',
        era: 'late',
        size: 'medium',
        target: 17,
        reward: rise(1, 'coin'),
      },
      {
        id: 'generator_4',
        name: 'The Generator, Finished',
        blurb: 'Twenty. Whatever you plug into it, it runs.',
        era: 'late',
        size: 'medium',
        target: 20,
        reward: rise(2, 'coin'),
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
    {
      id: 'raised_4',
      name: 'Two Hundred and Twenty Levels',
      blurb: 'Raised, one crew and one long afternoon at a time.',
      era: 'late',
      size: 'medium',
      target: 220,
      reward: rise(3, 'coin'),
    },
    {
      id: 'raised_5',
      name: 'Built and Rebuilt',
      blurb: 'Four hundred levels raised. Some of them twice, after somebody knocked them down.',
      era: 'late',
      size: 'large',
      target: 400,
      reward: rise(4, 'coin'),
    },
    {
      id: 'raised_6',
      name: 'The Builder',
      blurb: 'Seven hundred building levels raised over a lifetime of it.',
      era: 'late',
      size: 'large',
      target: 700,
      reward: rise(5, 'coin'),
    },
  ]),
  /*
   * Standing levels, against the district's true total rather than against eleven times the global
   * ceiling (2026-09-18).
   *
   * The top rung is "every roof at its ceiling", and that number stopped being 220 when the Garage
   * and the Infirmary were held to level 10: nine structures at 20 and two at 10 is 200, so the
   * rung as written could not be collected by anybody. `catalog.test.ts` derives the bound the
   * same way, per structure, so the next retune of a ceiling fails there instead of stranding this
   * ladder again.
   */
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
    {
      id: 'estate_4',
      name: 'A Hundred and Ninety Standing',
      blurb: 'Levels of building, all of it upright at the same time.',
      era: 'late',
      size: 'large',
      target: 190,
      reward: rise(7, 'coin'),
    },
    {
      id: 'estate_5',
      name: 'Nothing Left to Raise',
      blurb: 'Two hundred levels standing. Every roof is at its ceiling.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: rise(8, 'coin'),
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
      {
        id: 'gate_4',
        name: 'The Gate, Finished',
        blurb: 'Twenty levels of wall, door, and everything waiting behind it.',
        era: 'late',
        size: 'large',
        target: 20,
        reward: rise(7, 'coin'),
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
      {
        id: 'lab_4',
        name: 'The Lab, Finished',
        blurb: 'Twenty. There is no programme the bench cannot take on.',
        era: 'late',
        size: 'large',
        target: 20,
        reward: rise(7, 'schooling'),
      },
    ],
    'lab',
  ),
  /*
   * The Garage stops at level 10, not 20, so this ladder runs 1 / 4 / 7 / 10 (maintainer,
   * 2026-09-18).
   *
   * It used to ask for 8, 16 and 20. Two of those were rungs nobody could ever stand on once the
   * ceiling came down, and a feat pinned above its own ceiling is the failure this file's own doc
   * block describes: it sits at a percentage for ever and looks exactly like a feat nobody has got
   * round to. Same four feats and same rewards; only the numbers under them moved, and the top one
   * is a maxed Garage the way it always was.
   */
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
        blurb: 'Garage four. The big machines need somewhere to be.',
        era: 'late',
        size: 'medium',
        target: 4,
        reward: purse('late', 'medium'),
      },
      {
        id: 'garage_3',
        name: 'A Yard With a Name',
        blurb: 'A Garage at seven. Machines come out of it that nobody else can build.',
        era: 'late',
        size: 'large',
        target: 7,
        reward: wages('late', 'large'),
      },
      {
        id: 'garage_4',
        name: 'The Garage, Finished',
        blurb: 'Ten levels. Everything the game can build has a bay in there.',
        era: 'late',
        size: 'large',
        target: 10,
        reward: rise(7, 'coin'),
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
    {
      id: 'traps_4',
      name: 'Ninety Nasty Surprises',
      blurb: 'Laid around the perimeter and mostly forgotten about.',
      era: 'late',
      size: 'small',
      target: 90,
      reward: rise(0, 'coin'),
    },
    {
      id: 'traps_5',
      name: 'The Ground Bites',
      blurb: 'Two hundred traps laid. Walking here is a decision.',
      era: 'late',
      size: 'medium',
      target: 200,
      reward: rise(1, 'coin'),
    },
    {
      id: 'traps_6',
      name: 'Nobody Walks In',
      blurb: 'Four hundred and fifty traps. The perimeter does the first half of every fight.',
      era: 'late',
      size: 'medium',
      target: 450,
      reward: rise(2, 'coin'),
    },
    {
      id: 'traps_7',
      name: 'A Thousand Ways In, All Bad',
      blurb: 'A thousand traps laid over a lifetime of being visited.',
      era: 'late',
      size: 'medium',
      target: 1_000,
      reward: rise(3, 'coin'),
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
   *
   * "All of them" is 31 rather than 33 (2026-09-18). The third bracket opens at level 20
   * (`MODIFICATION_SLOT_LEVELS`), and the Garage and the Infirmary now stop at 10, so those two
   * never get a third one: nine structures with three brackets and two with two.
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
    {
      id: 'fittings_4',
      name: 'Twenty Seven Fitted',
      blurb: 'Cards in brackets across the whole district.',
      era: 'late',
      size: 'medium',
      target: 27,
      reward: rise(3, 'coin'),
    },
    {
      id: 'fittings_5',
      name: 'Every Bracket Full',
      blurb: 'Thirty one fittings, which is all of them. There is nowhere left to bolt anything.',
      era: 'late',
      size: 'large',
      target: 31,
      reward: rise(4, 'coin'),
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
    {
      id: 'kitted_4',
      name: 'Thirty Cards in Brackets',
      blurb: 'Units carrying something that was never issued to them.',
      era: 'late',
      size: 'medium',
      target: 30,
      reward: rise(3, 'bodies'),
    },
    {
      id: 'kitted_5',
      name: 'Nothing Off the Shelf',
      blurb: 'Forty cards fitted. Every unit that matters has been improved by hand.',
      era: 'late',
      size: 'large',
      target: 40,
      reward: rise(4, 'bodies'),
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
    {
      id: 'addons_4',
      name: 'The Yard Never Cools',
      blurb: 'A hundred and eighty fittings. The Scrapyard has not been empty in months.',
      era: 'late',
      size: 'large',
      target: 180,
      reward: rise(6, 'coin'),
    },
    {
      id: 'addons_5',
      name: 'Four Hundred Off the Bench',
      blurb: 'Cut, welded and bolted on, one at a time, by people who no longer read the plans.',
      era: 'late',
      size: 'large',
      target: 400,
      reward: rise(7, 'coin'),
    },
    {
      id: 'addons_6',
      name: 'A Trade of Its Own',
      blurb: 'Nine hundred fittings. The yard is a business the crew happens to own.',
      era: 'late',
      size: 'large',
      target: 900,
      reward: rise(8, 'coin'),
    },
    {
      id: 'addons_7',
      name: 'Two Thousand Bolted On',
      blurb: 'Nothing in the district is any longer the shape it was delivered in.',
      era: 'late',
      size: 'large',
      target: 2_000,
      reward: rise(9, 'coin'),
    },
    {
      id: 'addons_8',
      name: 'The Second Yard',
      blurb: 'Four thousand four hundred fittings, and one bench was never going to be enough.',
      era: 'late',
      size: 'large',
      target: 4_400,
      reward: rise(10, 'coin'),
    },
    {
      id: 'addons_9',
      name: 'Everything Twice Over',
      blurb:
        'Nine and a half thousand. Whatever you own, you have rebuilt it and then rebuilt that.',
      era: 'late',
      size: 'large',
      target: 9_500,
      reward: rise(11, 'coin'),
    },
    {
      id: 'addons_10',
      name: 'Twenty Thousand Welds',
      blurb: 'There is nothing left in the district the yard has not had its hands inside.',
      era: 'late',
      size: 'large',
      target: 20_000,
      reward: rise(12, 'coin'),
    },
  ]),

  /*
   * The end of the build queue (maintainer request, 2026-09-18).
   *
   * `buildings_total` counts standing levels and climbs the whole game, which makes it a good
   * ladder and a bad answer to "is the district done". This is the other question, and the last
   * rung is the only feat in the file that can be finished by having nothing left to build.
   *
   * The ceiling is not one number: the Garage and the Infirmary stop at 10 and everything else at
   * 20 (`building/kinds.ts`), so the measure asks each structure about its own. The last target is
   * read off `BUILDING_KINDS` rather than typed, because a twelfth structure has to move it.
   */
  ...chain('finished', 'buildings_maxed', [
    {
      id: 'finished_1',
      name: 'As High as It Goes',
      blurb: 'Take one structure all the way to its ceiling.',
      era: 'late',
      size: 'medium',
      target: 1,
      reward: wages('late', 'medium'),
    },
    {
      id: 'finished_2',
      name: 'Five at the Top',
      blurb: 'Five structures with nowhere left to build. The queue is getting picky.',
      era: 'late',
      size: 'large',
      target: 5,
      reward: wages('late', 'large'),
    },
    {
      id: 'finished_3',
      name: 'The Finished District',
      blurb: 'Every structure you own standing at its ceiling. There is nothing left to raise.',
      era: 'late',
      size: 'large',
      target: BUILDING_KINDS.length,
      reward: rise(7, 'coin'),
    },
  ]),
];

// --- the crew ---

const CREW: FeatSpec[] = [
  /**
   * The first rung of the game, finished before the player has seen the board.
   *
   * The opening had no move in it (maintainer, 2026-09-18). A new crew stands a Nexus and a
   * Generator, holds 600 caps against the 512 a second Nexus level costs, produces six oil an
   * hour and no caps at all, and every unit in the game was behind a Gauntlet that needs Nexus 3
   * and Quarters 2, so whatever it is handed is the only bodies it will see until missions pay
   * for a barracks, and missions need bodies.
   *
   * The opening kit changed on 2026-09-23: a crew is handed eight **Scavengers** rather than
   * eight Razors (`crew/starting.ts`), because the board's first runs are minutes long now and
   * what they want is loot capacity. This feat still pays five more, for the one thing a player
   * has already done by the time they read this sentence, and it has to: the rule this rung is
   * held to below is that what it pays is **trainable by a bare district**, so the player can go
   * and buy more of what just landed, and every fighter in the game is behind a Gauntlet that
   * wants Nexus 3. Fighters are earned instead, off the early reward bands and the training floor
   * once the Gauntlet is up. The rung after this one is `first_jobs`, which pays three more.
   *
   * Standalone rather than the head of a ladder, because it is the one feat in the catalogue
   * whose measure can never reach two: `POST /overseer` refuses a second character.
   */
  solo(
    {
      id: 'overseer_taken',
      name: 'Whose Name It Goes Under',
      blurb: 'Pick the person the district answers to. Five Scavengers turn up the same evening.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: { units: { scavengers: 5 } },
    },
    'overseer_taken',
  ),
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
    {
      id: 'roster_4',
      name: 'A Thousand Under Arms',
      blurb: 'Held at once, fed and housed, before anybody is sent anywhere.',
      era: 'late',
      size: 'medium',
      target: 1_000,
      reward: rise(3, 'bodies'),
    },
    {
      id: 'roster_5',
      name: 'The Standing Host',
      blurb: 'Sixteen hundred units on the books at the same time.',
      era: 'late',
      size: 'large',
      target: 1_600,
      reward: rise(4, 'bodies'),
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
    {
      id: 'beds_4',
      name: 'Fifteen Hundred Slots',
      blurb: 'Filled at once. The quartermaster has stopped sleeping.',
      era: 'late',
      size: 'medium',
      target: 1_500,
      reward: rise(3, 'coin'),
    },
    {
      id: 'beds_5',
      name: 'Every Bed in the District',
      blurb: 'Two thousand two hundred unit slots, all of them occupied.',
      era: 'late',
      size: 'large',
      target: 2_200,
      reward: rise(4, 'coin'),
    },
  ]),
  /*
   * The second bench (maintainer, 2026-09-21). The floor takes one person at a time until the
   * Professor's fourth rung, and this is the one feat that says the rung is worth researching:
   * the tally only moves once a drill starts beside a drill already running.
   */
  solo(
    {
      id: 'second_chair',
      name: 'Two at the Bench',
      blurb:
        'Put two people through drills at the same time. The Professor’s Second Chair opens the second bench.',
      era: 'mid',
      size: 'small',
      target: 1,
      reward: lesson('mid', 'small'),
    },
    'drills_paired',
  ),
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
    {
      id: 'trained_5',
      name: 'Two Generations',
      blurb:
        'Twenty two thousand through the drill yard. The instructors were trained here as well.',
      era: 'late',
      size: 'large',
      target: 22_000,
      reward: rise(7, 'bodies'),
    },
    {
      id: 'trained_6',
      name: 'Bigger Than the District',
      blurb:
        'Forty eight thousand units. More people have passed the gate than live on the street outside it.',
      era: 'late',
      size: 'large',
      target: 48_000,
      reward: rise(8, 'bodies'),
    },
    {
      id: 'trained_7',
      name: 'A Hundred Thousand Through',
      blurb: 'Trained, kitted and sent out. The yard runs whether anybody is watching it or not.',
      era: 'late',
      size: 'large',
      target: 105_000,
      reward: rise(9, 'bodies'),
    },
    {
      id: 'trained_8',
      name: 'Nobody Learned It Anywhere Else',
      blurb:
        'Two hundred and thirty thousand. The city’s whole trade in soldiers runs through one gate.',
      era: 'late',
      size: 'large',
      target: 230_000,
      reward: rise(10, 'bodies'),
    },
    {
      id: 'trained_9',
      name: 'Half a Million Taught',
      blurb: 'The drill is older than most of the crews using it against you.',
      era: 'late',
      size: 'large',
      target: 500_000,
      reward: rise(11, 'bodies'),
    },
    {
      id: 'trained_10',
      name: 'The Institution',
      blurb: 'A million and more through the yard. It will outlive everybody who ever ran it.',
      era: 'late',
      size: 'large',
      target: 1_100_000,
      reward: rise(12, 'bodies'),
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
    {
      id: 'kinds_4',
      name: 'Twenty Kinds',
      blurb: 'On the roster at once. Somebody has to remember what they all do.',
      era: 'late',
      size: 'medium',
      target: 20,
      reward: rise(3, 'bodies'),
    },
    {
      id: 'kinds_5',
      name: 'One of Nearly Everything',
      blurb: 'Twenty six kinds of unit held at the same time.',
      era: 'late',
      size: 'large',
      target: 26,
      reward: rise(4, 'bodies'),
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
    {
      id: 'officers_4',
      name: 'Twelve at the Table',
      blurb: 'Officers on the books, each with an opinion and a wage.',
      era: 'late',
      size: 'medium',
      target: 12,
      reward: rise(3, 'coin'),
    },
    {
      id: 'officers_5',
      name: 'A Full Table',
      blurb: 'Sixteen officers. The payroll is a line of work on its own.',
      era: 'late',
      size: 'large',
      target: 16,
      reward: rise(4, 'coin'),
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
    {
      id: 'hired_4',
      name: 'Eighty Signed',
      blurb: 'Hired over a lifetime. Most of them moved on.',
      era: 'late',
      size: 'small',
      target: 80,
      reward: rise(0, 'coin'),
    },
    {
      id: 'hired_5',
      name: 'The Revolving Door',
      blurb: 'Two hundred officers hired. The Bar keeps a stool for you.',
      era: 'late',
      size: 'medium',
      target: 200,
      reward: rise(1, 'coin'),
    },
    {
      id: 'hired_6',
      name: 'Five Hundred Signed On',
      blurb: 'Five hundred signed. It is hard to find a crew you have not staffed.',
      era: 'late',
      size: 'medium',
      target: 500,
      reward: rise(2, 'coin'),
    },
    {
      id: 'hired_7',
      name: 'The Employer',
      blurb: 'Twelve hundred officers hired. Half the city has your name on a contract.',
      era: 'late',
      size: 'medium',
      target: 1_200,
      reward: rise(3, 'coin'),
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
    {
      id: 'mark_4',
      name: 'The Last Mark',
      blurb: 'An officer at the top of the ladder. There is nothing above it to reach for.',
      era: 'late',
      size: 'large',
      target: 20,
      reward: rise(6, 'schooling'),
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
      {
        id: 'overseer_4',
        name: 'Sixteen Over Fifty',
        blurb: 'Skills on your own sheet past halfway. Most people pick two and stop.',
        era: 'late',
        size: 'large',
        target: 16,
        reward: rise(6, 'schooling'),
      },
      {
        id: 'overseer_5',
        name: 'Good at Nearly Everything',
        blurb: 'Twenty four skills over fifty. The gaps are getting hard to find.',
        era: 'late',
        size: 'large',
        target: 24,
        reward: rise(7, 'schooling'),
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
    {
      id: 'peak_4',
      name: 'Perfect at One Thing',
      blurb: 'A skill at the ceiling. There is no number above it.',
      era: 'late',
      size: 'medium',
      target: 100,
      reward: rise(2, 'schooling'),
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
    {
      id: 'fleet_4',
      name: 'Two Dozen Machines',
      blurb: 'In the bays at once, fuelled and waiting.',
      era: 'late',
      size: 'large',
      target: 24,
      reward: rise(6, 'coin'),
    },
    {
      id: 'fleet_5',
      name: 'The Motor Pool',
      blurb: 'Forty five machines. The garage has a traffic problem.',
      era: 'late',
      size: 'large',
      target: 45,
      reward: rise(7, 'coin'),
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
    {
      id: 'vehicles_4',
      name: 'Fifty Off the Line',
      blurb: 'Machines built out of nothing but plans and parts.',
      era: 'late',
      size: 'large',
      target: 50,
      reward: rise(6, 'coin'),
    },
    {
      id: 'vehicles_5',
      name: 'The Works',
      blurb: 'A hundred and twenty machines built. The garage is a factory now.',
      era: 'late',
      size: 'large',
      target: 120,
      reward: rise(7, 'coin'),
    },
    {
      id: 'vehicles_6',
      name: 'Three Hundred Built',
      blurb: 'Most of them are somebody else’s problem by now.',
      era: 'late',
      size: 'large',
      target: 300,
      reward: rise(8, 'coin'),
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
      {
        id: 'caps_4',
        name: 'Eight Million',
        blurb: 'Earned, and mostly spent again. The pile was never the point.',
        era: 'late',
        size: 'large',
        target: 8_000_000,
        reward: rise(6, 'coin'),
      },
      {
        id: 'caps_5',
        name: 'Twenty One Million',
        blurb: 'Through the till over a lifetime. The till has been replaced twice.',
        era: 'late',
        size: 'large',
        target: 21_000_000,
        reward: rise(7, 'coin'),
      },
      {
        id: 'caps_6',
        name: 'The House Bank',
        blurb: 'Fifty five million earned. Other crews keep their float with you now.',
        era: 'late',
        size: 'large',
        target: 55_000_000,
        reward: rise(8, 'coin'),
      },
      {
        id: 'caps_7',
        name: 'Past the Counting House',
        blurb: 'A hundred and forty five million. Nobody audits you, because nobody could.',
        era: 'late',
        size: 'large',
        target: 145_000_000,
        reward: rise(9, 'coin'),
      },
      {
        id: 'caps_8',
        name: 'The Rate Is Whatever You Say',
        blurb: 'Three hundred and eighty million earned. The market moves when you buy bread.',
        era: 'late',
        size: 'large',
        target: 380_000_000,
        reward: rise(10, 'coin'),
      },
      {
        id: 'caps_9',
        name: 'A Thousand Million',
        blurb: 'The figure stops meaning anything and you have it anyway.',
        era: 'late',
        size: 'large',
        target: 1_000_000_000,
        reward: rise(11, 'coin'),
      },
      {
        id: 'caps_10',
        name: 'Money Is a Thing You Do',
        blurb: 'Two and a half billion earned. Currency is a habit of yours the city picked up.',
        era: 'late',
        size: 'large',
        target: 2_600_000_000,
        reward: rise(12, 'coin'),
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
      {
        id: 'metal_4',
        name: 'Two Hundred Thousand of the Good Stuff',
        blurb: 'High quality metal earned over a lifetime of asking for it.',
        era: 'late',
        size: 'medium',
        target: 200_000,
        reward: rise(3, 'coin'),
      },
      {
        id: 'metal_5',
        name: 'The Smelter Never Cools',
        blurb: 'Eight hundred thousand. Other crews buy theirs; you make yours.',
        era: 'late',
        size: 'large',
        target: 800_000,
        reward: rise(4, 'coin'),
      },
      {
        id: 'metal_6',
        name: 'Three Million Ingots',
        blurb: 'The hard currency of anything worth building, through your hands.',
        era: 'late',
        size: 'large',
        target: 3_000_000,
        reward: rise(5, 'coin'),
      },
      {
        id: 'metal_7',
        name: 'Where the Metal Comes From',
        blurb: 'Ten million earned. The city’s good steel has your fingerprints on it.',
        era: 'late',
        size: 'large',
        target: 10_000_000,
        reward: rise(6, 'coin'),
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
    {
      id: 'trade_5',
      name: 'Six Hundred Deals',
      blurb: 'Listings of yours taken off the board by somebody else.',
      era: 'late',
      size: 'medium',
      target: 600,
      reward: rise(3, 'coin'),
    },
    {
      id: 'trade_6',
      name: 'Your Prices Are the Prices',
      blurb: 'Fourteen hundred sales. Your prices are the prices.',
      era: 'late',
      size: 'large',
      target: 1_400,
      reward: rise(4, 'coin'),
    },
    {
      id: 'trade_7',
      name: 'Three Thousand Handshakes',
      blurb: 'Sales closed. Nobody checks your goods any more.',
      era: 'late',
      size: 'large',
      target: 3_000,
      reward: rise(5, 'coin'),
    },
    {
      id: 'trade_8',
      name: 'The Market Is You',
      blurb: 'Six and a half thousand deals. The board is mostly your paper.',
      era: 'late',
      size: 'large',
      target: 6_500,
      reward: rise(6, 'coin'),
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
    {
      id: 'buys_4',
      name: 'Four Hundred Bought',
      blurb: 'Listings, supply runs, barter with the Broker and lots won.',
      era: 'late',
      size: 'medium',
      target: 400,
      reward: rise(3, 'coin'),
    },
    {
      id: 'buys_5',
      name: 'A Thousand Times Paid',
      blurb: 'Bought rather than built, and faster for it.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: rise(4, 'coin'),
    },
    {
      id: 'buys_6',
      name: 'First Call at the Broker',
      blurb: 'Two and a half thousand purchases. The Broker takes your call first.',
      era: 'late',
      size: 'large',
      target: 2_500,
      reward: rise(5, 'coin'),
    },
    {
      id: 'buys_7',
      name: 'Everything Has a Price',
      blurb: 'Six thousand deals taken. You have never once made your own rope.',
      era: 'late',
      size: 'large',
      target: 6_000,
      reward: rise(6, 'coin'),
    },
  ]),
  ...chain('contraband', 'contraband_taken', [
    {
      id: 'contraband_1',
      name: 'The Back Room',
      blurb: 'Win a lot in the back room behind the market. It costs a name, not caps.',
      era: 'early',
      size: 'small',
      target: 1,
      reward: purse('early', 'small'),
    },
    {
      id: 'contraband_2',
      name: 'A Regular Back There',
      blurb: 'Fifteen crates won. They know your bid before you write it.',
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
      blurb: 'Fifty lots out of the back room, every one of them outbid somebody.',
      era: 'late',
      size: 'medium',
      target: 50,
      reward: kit('late', 'medium'),
    },
    {
      id: 'contraband_4',
      name: 'A Standing Arrangement',
      blurb: 'Two hundred won back there. They restock for you specifically.',
      era: 'late',
      size: 'large',
      target: 200,
      reward: spoils('late', 'large'),
    },
    {
      id: 'contraband_5',
      name: 'Four Hundred and Fifty Off the Shelf',
      blurb: 'Back-room lots won at midnight and used by morning.',
      era: 'late',
      size: 'large',
      target: 450,
      reward: rise(4, 'blood'),
    },
    {
      id: 'contraband_6',
      name: 'The Back Room Regular',
      blurb: 'A thousand crates won. They stopped asking what it is for.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: rise(5, 'blood'),
    },
    {
      id: 'contraband_7',
      name: 'Nothing Is Off Limits',
      blurb: 'Two thousand two hundred crates won in the back room over a lifetime.',
      era: 'late',
      size: 'large',
      target: 2_200,
      reward: rise(6, 'blood'),
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
    {
      id: 'infamy_4',
      name: 'Told as a Warning',
      blurb: 'Sixty thousand earned. People end arguments with your name.',
      era: 'late',
      size: 'large',
      target: 60_000,
      reward: rise(6, 'blood'),
    },
    {
      id: 'infamy_5',
      name: 'No Introduction',
      blurb: 'A hundred and forty five thousand. Nobody asks which crew.',
      era: 'late',
      size: 'large',
      target: 145_000,
      reward: rise(7, 'blood'),
    },
    {
      id: 'infamy_6',
      name: 'The Price of a Rank',
      blurb:
        'Three hundred and twenty thousand, which is about what the seventh rung of the ladder costs.',
      era: 'late',
      size: 'large',
      target: 320_000,
      reward: rise(8, 'blood'),
    },
    {
      id: 'infamy_7',
      name: 'Three Quarters of a Million',
      blurb: 'The street stopped grading you against other crews a long way back.',
      era: 'late',
      size: 'large',
      target: 750_000,
      reward: rise(9, 'blood'),
    },
    {
      id: 'infamy_8',
      name: 'A Story Told Wrong',
      blurb:
        'One million seven hundred thousand. The versions people tell are worse than the truth, and you let them be.',
      era: 'late',
      size: 'large',
      target: 1_700_000,
      reward: rise(10, 'blood'),
    },
    {
      id: 'infamy_9',
      name: 'Four Million Reasons',
      blurb: 'Earned one dead body and one taken street at a time.',
      era: 'late',
      size: 'large',
      target: 4_000_000,
      reward: rise(11, 'blood'),
    },
    {
      id: 'infamy_10',
      name: 'The Name Itself',
      blurb: 'Nine million infamy earned. The city has run out of ways of saying it.',
      era: 'late',
      size: 'large',
      target: 9_000_000,
      reward: rise(12, 'blood'),
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
    {
      id: 'notoriety_4',
      name: 'Ten Rungs Up',
      blurb: 'Buy the tenth rank on the ladder. The old words for you are wearing out.',
      era: 'late',
      size: 'large',
      target: 10,
      reward: rise(6, 'blood'),
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
    {
      id: 'research_4',
      name: 'A Hundred and Ten Programmes',
      blurb: 'Finished at the bench. The Lab has a filing problem.',
      era: 'late',
      size: 'medium',
      target: 110,
      reward: rise(3, 'schooling'),
    },
    {
      id: 'research_5',
      name: 'Most of What There Is to Know',
      blurb: 'A hundred and fifty programmes done and written up.',
      era: 'late',
      size: 'large',
      target: 150,
      reward: rise(4, 'schooling'),
    },
    {
      id: 'research_6',
      name: 'The Whole Book',
      blurb: 'Every programme the Lab has ever been able to run.',
      era: 'late',
      size: 'large',
      // 180 since 2026-09-22: eighteen chairs, ten rungs each. It was 190 with the Scout's track,
      // and a target above the ceiling is a feat that sits at 94% for ever.
      target: 180,
      reward: rise(5, 'schooling'),
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
    {
      id: 'pages_4',
      name: 'Two Hundred Pages',
      blurb: 'Found in hauls, bought off fences, taken off the dead.',
      era: 'late',
      size: 'medium',
      target: 200,
      reward: rise(3, 'coin'),
    },
    {
      id: 'pages_5',
      name: 'The Library',
      blurb: 'Four hundred and fifty pages. Somebody should bind these.',
      era: 'late',
      size: 'large',
      target: 450,
      reward: rise(4, 'coin'),
    },
    {
      id: 'pages_6',
      name: 'A Thousand Leaves',
      blurb: 'Pages found. Most blueprints came to you in pieces.',
      era: 'late',
      size: 'large',
      target: 1_000,
      reward: rise(5, 'coin'),
    },
    {
      id: 'pages_7',
      name: 'Paper Is a Habit',
      blurb: 'Two thousand two hundred pages recovered over a lifetime.',
      era: 'late',
      size: 'large',
      target: 2_200,
      reward: rise(6, 'coin'),
    },
  ]),
  /**
   * The Reimagining bench, paying out at the top tier.
   *
   * Three sheets in the sockets buy one the crew has never seen, and since the tiers went in
   * (`blueprints/reimagine-odds.ts`) what comes back depends on what went in: three Basic sheets
   * pay a Masterpiece once in two hundred, three Masterpiece sheets pay one four times in five.
   * That spread is the whole ladder. The first rung is a thing that happens to a crew and the
   * third is a thing a crew does on purpose, by spending dear paper to make dearer paper.
   *
   * Only three rungs, because the supply is small by construction: the game holds thirty eight
   * Masterpiece sheets against two hundred and fifty five pages, and a fourth rung would be asking
   * a player to run the bench for its own sake.
   */
  ...chain('bench', 'masterpieces_reimagined', [
    {
      id: 'bench_1',
      name: 'One Good Sheet',
      blurb:
        'The Lab hands back a Masterpiece page. On cheap paper that is one trade in two hundred.',
      era: 'mid',
      // A Masterpiece sheet back for a Masterpiece sheet out. The point of the rung is to show a
      // player what the sockets are for, and a page of the Colossus is the clearest way to say it.
      size: 'small',
      target: 1,
      reward: leaves('pg_colossus_reactor_housing', 1),
    },
    {
      id: 'bench_2',
      name: 'Five Off the Bench',
      blurb:
        'Five Masterpiece pages out of the Lab. You are choosing what goes in the sockets now.',
      era: 'late',
      size: 'medium',
      target: 5,
      reward: kit('late', 'medium'),
    },
    {
      id: 'bench_3',
      name: 'Nothing Cheap Goes In',
      blurb: 'Fifteen Masterpiece pages reimagined. The bench only gets fed the good stuff.',
      era: 'late',
      size: 'large',
      target: 15,
      reward: rise(4, 'coin'),
    },
  ]),
  /**
   * The Right Hand's standing orders (§C2b): parties that went out with nobody at the screen.
   *
   * Counted at the send rather than at the return, because what the ladder measures is trust in
   * the chair, not luck on the road. Four rungs and no more: at a fifteen minute gap a slot sends
   * about three parties an hour, two slots six, so four hundred is a month of leaving the board to
   * somebody else, which is as far as a feat should ask a player to look away from the game.
   */
  ...chain('orders', 'automated_parties', [
    {
      id: 'orders_1',
      name: 'Leave It With Me',
      blurb: 'One party out on a standing order. You were not there, and it went anyway.',
      era: 'mid',
      size: 'small',
      target: 1,
      reward: purse('mid', 'small'),
    },
    {
      id: 'orders_2',
      name: 'While You Were Out',
      blurb: 'Twenty five parties sent by the Right Hand. The board stopped waiting for you.',
      era: 'mid',
      size: 'medium',
      target: 25,
      reward: purse('mid', 'medium'),
    },
    {
      id: 'orders_3',
      name: 'The Room Runs Itself',
      blurb: 'A hundred. A second slot, a shorter gap, and a chair that has stopped asking.',
      era: 'late',
      size: 'medium',
      target: 100,
      reward: kit('late', 'medium'),
    },
    {
      id: 'orders_4',
      name: 'Gone a Month',
      blurb: 'Four hundred parties out on standing orders. Come back and find it as you left it.',
      era: 'late',
      size: 'large',
      target: 400,
      reward: purse('late', 'large'),
    },
  ]),
  /**
   * The bench itself, pressed. `masterpieces_reimagined` above counts what came out at the top
   * tier; this counts the pressing, which is the habit the screen is trying to build.
   */
  ...chain('lever', 'bench_trades', [
    {
      id: 'lever_1',
      name: 'Three In, One Out',
      blurb: 'Run the Reimagining bench once. Three pages you had for one you did not.',
      era: 'mid',
      size: 'small',
      target: 1,
      reward: purse('mid', 'small'),
    },
    {
      id: 'lever_2',
      name: 'Feeding the Machine',
      blurb: 'Ten runs of the bench. The spares are not spares any more, they are fuel.',
      era: 'mid',
      size: 'medium',
      target: 10,
      reward: kit('mid', 'medium'),
    },
    {
      id: 'lever_3',
      name: 'The Lab Eats First',
      blurb: 'Forty runs. Every page that comes home goes past the sockets before the shelf.',
      era: 'late',
      size: 'medium',
      target: 40,
      reward: purse('late', 'medium'),
    },
  ]),
  solo(
    {
      id: 'lever_done',
      name: 'Nothing Left to Want',
      blurb:
        'Run the bench with every page in the game held or bound. It pays in experience now, and this is the receipt.',
      era: 'late',
      size: 'large',
      target: 1,
      reward: purse('late', 'large'),
    },
    'bench_experience',
  ),
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
    {
      id: 'blueprints_4',
      name: 'Twenty Five Blueprints',
      blurb: 'Unlocked and buildable, whether or not you ever build them.',
      era: 'late',
      size: 'large',
      target: 25,
      reward: rise(6, 'coin'),
    },
    {
      id: 'blueprints_5',
      name: 'Most of the Book',
      blurb: 'Forty five blueprints unlocked. The gaps are the expensive ones.',
      era: 'late',
      size: 'large',
      target: 45,
      reward: rise(7, 'coin'),
    },
    {
      id: 'blueprints_6',
      name: 'Every Plan There Is',
      blurb: 'All sixty eight. Nothing in this city is a mystery to your bench.',
      era: 'late',
      size: 'large',
      target: 68,
      reward: rise(8, 'coin'),
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
    {
      id: 'level_6',
      name: 'Level Seventy',
      blurb: 'Whatever the city was when you arrived, it is not that now.',
      era: 'late',
      size: 'large',
      target: 70,
      reward: rise(6, 'schooling'),
    },
    {
      id: 'level_7',
      name: 'Level One Hundred',
      blurb: 'There is nobody above you on any list that matters.',
      era: 'late',
      size: 'large',
      target: 100,
      reward: rise(7, 'schooling'),
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
    {
      id: 'faction_4',
      name: 'The Badge Travels',
      blurb: 'A hundred and thirty thousand under one badge. Wearing it gets you served first.',
      era: 'late',
      size: 'large',
      target: 130_000,
      reward: rise(6, 'bodies'),
    },
    {
      id: 'faction_5',
      name: 'A Table Nobody Sits At Twice',
      blurb: 'Three hundred and forty thousand won between you.',
      era: 'late',
      size: 'large',
      target: 340_000,
      reward: rise(7, 'bodies'),
    },
    {
      id: 'faction_6',
      name: 'Everybody Has Lost Somebody',
      blurb:
        'Nine hundred thousand under the badge. Every crew in the city has lost someone to yours.',
      era: 'late',
      size: 'large',
      target: 900_000,
      reward: rise(8, 'bodies'),
    },
    {
      id: 'faction_7',
      name: 'A Condition of the City',
      blurb: 'Two million four hundred thousand. You are not a faction, you are weather.',
      era: 'late',
      size: 'large',
      target: 2_400_000,
      reward: rise(9, 'bodies'),
    },
    {
      id: 'faction_8',
      name: 'What the Colours Mean',
      blurb: 'Six million won together. Nobody has to be told what they are looking at.',
      era: 'late',
      size: 'large',
      target: 6_000_000,
      reward: rise(10, 'bodies'),
    },
    {
      id: 'faction_9',
      name: 'The Other Government',
      blurb: 'Sixteen million under one badge. The Combine negotiates rather than declares.',
      era: 'late',
      size: 'large',
      target: 16_000_000,
      reward: rise(11, 'bodies'),
    },
    {
      id: 'faction_10',
      name: 'One Badge, One City',
      blurb:
        'Forty million. There is the city, and there is you, and lately those are one sentence.',
      era: 'late',
      size: 'large',
      target: 40_000_000,
      reward: rise(12, 'bodies'),
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
    {
      id: 'letters_4',
      name: 'Four Hundred Letters',
      blurb: 'Written and sent. Somebody reads all of these.',
      era: 'late',
      size: 'small',
      target: 400,
      reward: rise(0, 'coin'),
    },
    {
      id: 'letters_5',
      name: 'The Correspondent',
      blurb: 'Nine hundred letters out. Half the city owes you a reply.',
      era: 'late',
      size: 'medium',
      target: 900,
      reward: rise(1, 'coin'),
    },
    {
      id: 'letters_6',
      name: 'Two Thousand Sent',
      blurb: 'Letters. There is a version of this city that runs on your post.',
      era: 'late',
      size: 'medium',
      target: 2_000,
      reward: rise(2, 'coin'),
    },
    {
      id: 'letters_7',
      name: 'Nothing Goes Unsaid',
      blurb: 'Four and a half thousand letters sent over a lifetime of having opinions.',
      era: 'late',
      size: 'medium',
      target: 4_500,
      reward: rise(3, 'coin'),
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
  ...COMBINE,
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
