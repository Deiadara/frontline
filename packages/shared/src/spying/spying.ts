import { z } from 'zod';
import { ATTRIBUTE_NAMES, SPY_DEFENCE_ATTRIBUTES, type Attributes } from '../attributes.js';
import { softCap } from '../battle/soft-cap.js';
import { OFFICER_MARKS, markFromPoints, markIndex } from '../crew/marks.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import {
  SPY_COURIER_RESEARCH_ID,
  SPY_PAID_TIERS_RESEARCH_ID,
  SPY_SLEEPERS_RESEARCH_ID,
  SPY_WHOLE_WIRE_RESEARCH_ID,
  findResearchItem,
} from '../research/tracks.js';
import { mulberry32, seedFrom } from '../rng.js';
import { ArmySchema, armySize, type Army } from '../units/index.js';
import { cancelWindowMs, turnaroundMs } from '../time/cancel.js';

/**
 * Spying: what a Master of Whispers can find out about a place, and what it costs (maintainer
 * ruling, 2026-09-22).
 *
 * The old model told every crew a blurred head count for free, sharpened by an intel percentage.
 * It is gone. Nothing about a garrison is known now until somebody pays to find out, and what
 * comes back is a **report**: a list of units the spies were able to uncover, never one they were
 * not, and never a unit that is not there.
 *
 * ## The contest
 *
 * Two scores, and the difference is a budget.
 *
 * Sending a job needs the chair filled and nothing else: no rung, no building, just somebody
 * in it (maintainer, 2026-09-22).
 *
 * The spying side is the Master of Whispers' fit for their chair (10..100 points), plus every
 * intel bonus the crew holds (`intelYieldPercent`, read as points), and the whole of that is then
 * raised by the **tier** of the job, as a share of the points rather than a flat sum: the tiers
 * are priced so that caps are worth more to a crew that already has a good chair, which is what
 * makes hiring one the first move rather than the last.
 *
 * The officer side of it is the grade and nothing else (maintainer, 2026-10-01: "spy bonuses from
 * the officer should only come based on his grade", and the same rule for defence). No other
 * officer's ratings and no rung pay either bonus: what is left is perks and held ground on the
 * spying side, and perks on the other, beside the gate and the counter-intelligence cards.
 *
 * The other side is whoever holds the place. A crew's own Master of Whispers, their fit for the
 * chair read exactly as it is read when they send a job, so two equal chairs cancel and the tier,
 * the bonuses and the gate decide (maintainer, 2026-10-01); plus their counter-intel bonuses, plus
 * the gate on a player's district or on a district they hold whole. Looter and Combine ground carry no chair, so they carry flat points off the district's
 * difficulty and the location's own defence instead, and the Combine's a good deal more of both.
 *
 * ## The report
 *
 * The budget buys bodies, cheapest first: every body costs its stealth, so a line of Razors is
 * read before a line of Ghosts, and a force that is all Ghosts costs the most to read at all.
 * Accuracy is the share of the bodies there that were exposed, in bodies rather than slots, and
 * a report under `SPY_REPORT_FLOOR` fails outright: the caps are spent and nothing is learnt. Two
 * kinds of unit are never in the count: a Specter (`UnitSpec.unspyable`), which is only ever met
 * in a battle report, and a Sleeper, until the Master of Whispers' track says otherwise.
 *
 * What a report *says* is the track's (maintainer, 2026-09-28): unit slots and no names before
 * Written Reports, the accuracy and the estimate on their own rungs, and from The Whole Wire the
 * exact unit slots standing there whatever the job managed. Whether the holder hears of it is the
 * track too: every job is seen until Traffic Analysis, and after it the chair's grade decides
 * ({@link spyUnnoticedChance}).
 */

export const SPY_TIERS = [
  'loose_ears',
  'paid_whisper',
  'bought_eyes',
  'network_compromise',
  'total_intelligence',
] as const;
export const SpyTierSchema = z.enum(SPY_TIERS);
export type SpyTier = z.infer<typeof SpyTierSchema>;

export interface SpyTierSpec {
  label: string;
  /** What it costs, in caps, taken when the job is sent and never refunded. */
  caps: number;
  /**
   * What it adds to the spying score, as a share of the points the chair and the bonuses bring.
   *
   * A share and not a sum (maintainer, 2026-09-22): ten thousand caps on top of a bad chair is
   * still a bad chair, and the same ten thousand on an S grade reads a walled district.
   */
  boost: number;
  blurb: string;
  /**
   * The Master of Whispers' rung that opens the tier, or null for the one every chair can buy
   * (maintainer, 2026-09-28). Read by the send and drawn by the picker, which names the rung on a
   * shut tier rather than hiding it.
   */
  opensWith: string | null;
}

/*
 * The three middle boosts were 0.4, 1.2 and 1.6 until the maintainer took the spy bonuses off
 * every rating and rung (2026-10-01) and then asked for the cheap tiers back where they were: "a
 * mid-game crew spying an equal crew" at about 40% on Paid Whisper and 90% or more on Bought Eyes,
 * with the officers' Signals and Cryptography in. Measured on a modelled mid crew whose other
 * officers average 30 to 45 on the two: Paid Whisper reads 47% to 37%, Bought Eyes 98% to 92%.
 * Network Compromise went to 2.1 so it is clearly worth its 5,000 caps over Bought Eyes' 2,000
 * (maintainer, 2026-10-01: "about 2.1"); it was 1.8 for a few hours, just over the climb, and a B+
 * chair reads the good rival of the anchors at 97% on it now, where it read about 80%.
 */
export const SPY_TIER_SPECS: Readonly<Record<SpyTier, SpyTierSpec>> = {
  loose_ears: {
    label: 'Loose Ears',
    caps: 100,
    boost: 0,
    blurb: 'A drink for whoever talks. Somebody usually does.',
    opensWith: null,
  },
  paid_whisper: {
    label: 'Paid Whisper',
    caps: 500,
    boost: 0.8,
    blurb: 'One person on the inside, paid to say what they see.',
    opensWith: SPY_PAID_TIERS_RESEARCH_ID,
  },
  bought_eyes: {
    label: 'Bought Eyes',
    caps: 2000,
    boost: 1.7,
    blurb: 'A watcher on the roof opposite for as long as it takes.',
    opensWith: SPY_PAID_TIERS_RESEARCH_ID,
  },
  network_compromise: {
    label: 'Network Compromise',
    caps: 5000,
    boost: 2.1,
    blurb: 'Their own runners carrying your questions along with their messages.',
    opensWith: SPY_SLEEPERS_RESEARCH_ID,
  },
  /*
   * Half as strong again as it was, for a fifth more (maintainer, 2026-09-28: "about 50% stronger
   * ... for a 20% extra cost"): the boost was 2.6 on 10,000 caps. Half as strong again on the
   * job's score, not on the boost (maintainer, 2026-10-01): 1 + 4.4 is 1.5 times 1 + 2.6.
   */
  total_intelligence: {
    label: 'Total Intelligence',
    caps: 12000,
    boost: 4.4,
    blurb: 'Everyone who can be bought, bought at once. There is nothing left to hide behind.',
    opensWith: SPY_WHOLE_WIRE_RESEARCH_ID,
  },
};

/** Whether a crew holding these rungs can buy this tier. */
export function spyTierOpen(tier: SpyTier, technologies: readonly string[]): boolean {
  const rung = SPY_TIER_SPECS[tier].opensWith;
  return rung === null || technologies.includes(rung);
}

/** The tiers a crew holding these rungs can buy, cheapest first. */
export function openSpyTiers(technologies: readonly string[]): SpyTier[] {
  return SPY_TIERS.filter((tier) => spyTierOpen(tier, technologies));
}

/**
 * How many jobs a crew may have out at once before any rung: one (maintainer, 2026-09-22). Two
 * Sets of Eyes adds a second through `CrewEffects.spyPartiesFlat`.
 */
export const SPY_BASE_PARTIES = 1;

export function spyPartiesAllowed(spyPartiesFlat: number): number {
  return SPY_BASE_PARTIES + Math.max(0, spyPartiesFlat);
}

// --- being seen ---

/**
 * The chance a job comes and goes without the holder knowing, 0..1 (maintainer, 2026-09-28).
 *
 * Nothing before Traffic Analysis: "before this you have 100% chance of being found out". After
 * it the chair's grade decides, linearly on the mark ladder from nothing at `F-` to certainty at
 * `S+` ("0 to 100"). The ladder index rather than the points, because the ruling is written in
 * grades and a grade is what the player reads on the chair.
 */
export function spyUnnoticedChance(quiet: boolean, chairPoints: number): number {
  if (!quiet) return 0;
  return markIndex(markFromPoints(chairPoints)) / (OFFICER_MARKS.length - 1);
}

/**
 * Whether this job was seen, rolled once off the run's own id.
 *
 * Off the id rather than off the clock or `Math.random`, so the same run settles the same way
 * however many times the world is replayed or a settle is retried after a throw (`world/guard.ts`).
 */
export function spyFoundOut(runId: string, unnoticedChance: number): boolean {
  return mulberry32(seedFrom(`spy-seen:${runId}`))() >= unnoticedChance;
}

/** A report that would say less than this is not a report. The caps are gone either way. */
export const SPY_REPORT_FLOOR = 0.25;

/**
 * What one body costs to expose: a flat part, so an army of zero-stealth bodies is still work to
 * count, and a part per point of stealth, which is what the rating is for in a spy's hands.
 */
export const SPY_BODY_COST = 1;
export const SPY_STEALTH_COST_PER_POINT = 1 / 36;

/** What a gate is worth to the defence, per level, on a player's district or one held whole. */
export const SPY_GATE_POINTS_PER_LEVEL = 10;

/**
 * The rest of the room's guard against spies (maintainer, 2026-10-01): "when being spied, a small
 * percent is affected by the defending officers' signals and cryptography ... That is the case for
 * all non master of whispers officers", and the Overseer with them since 2026-10-04.
 *
 * Read as the mean of these two over every officer seated and working, the Master of Whispers
 * left out (their whole sheet is already on the other side of the contest as their grade), off the
 * sheet the room lifts them to. It moves the holder's whole counter score by a percentage.
 */
export { SPY_DEFENCE_ATTRIBUTES };

/** The mean at which the officers neither help nor hurt: "about break even at 30". */
export const SPY_DEFENCE_BREAK_EVEN = 30;

/** At a mean of 1: "at worst making it about 10% easier if they were both 1". */
export const SPY_DEFENCE_FLOOR_PERCENT = -10;

/**
 * What the officers can add, closed on and never reached: "up to roughly 25%". About 20 at a mean
 * of 70 and 23.5 at 100 (`softCap` with no knee, so the first point past 30 pays a whole one).
 */
export const SPY_DEFENCE_CEILING_PERCENT = 25;

/**
 * The officers' mean over the two skills, or null with nobody but the Master of Whispers working.
 * Takes the sheets of the officers it counts; the caller decides who those are.
 */
export function spyDefenceMean(sheets: readonly Attributes[]): number | null {
  if (sheets.length === 0) return null;
  const total = sheets.reduce(
    (sum, sheet) => sum + SPY_DEFENCE_ATTRIBUTES.reduce((pair, name) => pair + sheet[name], 0),
    0,
  );
  return total / (sheets.length * SPY_DEFENCE_ATTRIBUTES.length);
}

/**
 * The percentage the officers move the holder's counter score by: linear from -10 at a mean of 1
 * to nothing at 30, then up and tapering toward +25. Nothing for a room with no officer to read.
 */
export function spyDefencePercent(mean: number | null): number {
  if (mean === null) return 0;
  if (mean <= SPY_DEFENCE_BREAK_EVEN) {
    const below = SPY_DEFENCE_BREAK_EVEN - Math.max(1, mean);
    // A plain nought at the break-even, not the floor times nothing, which is -0.
    return below === 0 ? 0 : (SPY_DEFENCE_FLOOR_PERCENT * below) / (SPY_DEFENCE_BREAK_EVEN - 1);
  }
  return softCap(mean - SPY_DEFENCE_BREAK_EVEN, 0, SPY_DEFENCE_CEILING_PERCENT);
}

/**
 * Looter and Combine ground carry no Master of Whispers. They carry the district's difficulty and the
 * location's own defence instead, and the Combine's regime a good deal more of both: a Combine
 * district is meant to be an event to read, the way it is an event to enter.
 */
export const SPY_NPC_BASE_POINTS = { looters: 6, government: 22 } as const;
export const SPY_NPC_DIFFICULTY_POINTS = { looters: 3, government: 5 } as const;
export const SPY_NPC_DEFENSE_SHARE = { looters: 0.15, government: 0.3 } as const;

export interface SpyStrength {
  /** The Master of Whispers' fit for the chair, as points: 10..100. */
  chairPoints: number;
  /** Every intel bonus the crew holds, as points: perks and held ground, never a rating. */
  intelPercent: number;
  tier: SpyTier;
}

export function spyScore({ chairPoints, intelPercent, tier }: SpyStrength): number {
  const points = Math.max(0, chairPoints) + Math.max(0, intelPercent);
  return points * (1 + SPY_TIER_SPECS[tier].boost);
}

export type CounterStrength =
  | {
      kind: 'crew';
      /**
       * Their Master of Whispers' fit for the chair, or null with nobody working it. The same figure
       * `SpyStrength.chairPoints` is on their own jobs, so an equal chair on each side cancels.
       */
      whispersChairPoints: number | null;
      /** Their counter-intel perks and the district's counter-intel cards, as points. */
      intelResistancePercent: number;
      /** The gate over the place: their district's own, or the captured gate on ground held whole. */
      gateLevel: number;
      /**
       * Their other officers' Signals and Cryptography, as a percentage on the whole of the above
       * ({@link spyDefencePercent}): -10 to toward +25.
       */
      officersPercent: number;
    }
  | {
      kind: 'looters' | 'government';
      /** The district's difficulty, 1..10. */
      districtDifficulty: number;
      /** The location's catalogue defence. */
      baseDefense: number;
    };

export function counterScore(counter: CounterStrength): number {
  if (counter.kind === 'crew') {
    const summed =
      Math.max(0, counter.whispersChairPoints ?? 0) +
      Math.max(0, counter.intelResistancePercent) +
      Math.max(0, counter.gateLevel) * SPY_GATE_POINTS_PER_LEVEL;
    // After everything else is summed (maintainer, 2026-10-01): the officers move the whole guard.
    return summed * (1 + counter.officersPercent / 100);
  }
  return (
    SPY_NPC_BASE_POINTS[counter.kind] +
    counter.districtDifficulty * SPY_NPC_DIFFICULTY_POINTS[counter.kind] +
    counter.baseDefense * SPY_NPC_DEFENSE_SHARE[counter.kind]
  );
}

/** What exposing one body of a unit costs the budget. */
export function bodyCost(stealth: number): number {
  return SPY_BODY_COST + Math.max(0, stealth) * SPY_STEALTH_COST_PER_POINT;
}

/**
 * One owner's units on the ground, read at that owner's stealth (maintainer, 2026-10-01): a
 * faction ally's posting or a third crew's Sleepers carry their own cards and ground, not the
 * holder's.
 */
export interface SpiedForce {
  army: Army;
  /** The unit's stealth as its owner fields it, bonuses in. */
  stealthOf: (unitId: string) => number;
}

export interface ExposureInput {
  /** Who is there, one entry per owner. */
  forces: readonly SpiedForce[];
  /** Whether a spy can ever see this unit: false for a Specter, and for a Sleeper without the rung. */
  visible: (unitId: string) => boolean;
  budget: number;
}

export interface Exposure {
  /** What was uncovered. Never a unit that is not there, never more of one than are there. */
  exposed: Army;
  exposedBodies: number;
  /** The bodies a spy could ever have counted: what is there, less the unspyable. */
  countable: number;
  /**
   * `exposedBodies / countable`, 0..1. On empty ground, one when the spy beat the counter and zero
   * when it did not (bug pass, 2026-10-02): an empty gate always read, so a failed report alone
   * told the spy somebody was standing there, which is what the counter is paid to hide.
   */
  accuracy: number;
  /**
   * How much of the countable force was *not* seen, for the estimate a late rung prints. Zero
   * when everything was, so a full report has nothing to hedge.
   */
  unseen: number;
}

/**
 * Spend the budget on bodies, cheapest first.
 *
 * Every owner's stack is priced at that owner's stealth, then all of them are taken in stealth
 * order, then id order, then the order the forces were given in, so the walk is deterministic and
 * two reports on the same ground with the same budget read the same. What is seen is merged by
 * unit id: the report names units, not whose they are. A stack the budget runs out inside is
 * reported as far as it reached: seeing six of ten Razors is a fact, not a guess.
 */
export function expose({ forces, visible, budget }: ExposureInput): Exposure {
  const stacks = forces
    .flatMap((force, order) =>
      Object.entries(force.army)
        .filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0 && visible(entry[0]))
        .map(([unitId, count]) => ({ unitId, count, order, stealth: force.stealthOf(unitId) })),
    )
    .sort((a, b) => a.stealth - b.stealth || a.unitId.localeCompare(b.unitId) || a.order - b.order);
  const countable = stacks.reduce((total, stack) => total + stack.count, 0);
  const exposed: Army = {};
  let exposedBodies = 0;
  let left = Math.max(0, budget);
  for (const { unitId, count, stealth } of stacks) {
    const cost = bodyCost(stealth);
    const seen = Math.min(count, Math.floor(left / cost + 1e-9));
    if (seen <= 0) break;
    exposed[unitId] = (exposed[unitId] ?? 0) + seen;
    exposedBodies += seen;
    left -= seen * cost;
  }
  return {
    exposed,
    exposedBodies,
    countable,
    accuracy: countable === 0 ? (budget > 0 ? 1 : 0) : exposedBodies / countable,
    unseen: countable - exposedBodies,
  };
}

/**
 * The accuracy as a report prints it: to the nearest tenth, and never a full hundred unless nothing
 * was missed (maintainer, 2026-10-01). Exact, it gave the whole count back: `exposed` divided by it
 * is the figure The Whole Wire is sold for.
 */
export function roughAccuracy(accuracy: number): number {
  if (accuracy >= 1) return 1;
  return Math.min(0.9, Math.round(accuracy * 10) / 10);
}

/**
 * The bodies missed as a report prints them: a guess, not a count (maintainer, 2026-10-01). A
 * handful reads as five, a few more as ten, then the nearest ten, and past a hundred the nearest
 * fifty. Nothing missed stays nothing.
 */
export function roughUnseen(unseen: number): number {
  if (unseen <= 0) return 0;
  if (unseen < 8) return 5;
  if (unseen < 100) return Math.max(10, Math.round(unseen / 10) * 10);
  return Math.round(unseen / 50) * 50;
}

/** Whether a report at this accuracy is a report at all. */
export function spyReportStands(accuracy: number): boolean {
  return accuracy >= SPY_REPORT_FLOOR;
}

// --- the job on the clock ---

/**
 * The longest the runners spend on the ground, in minutes, before the Master of Whispers' sheet is
 * read.
 *
 * Four hours for a chair with nothing to recommend it. Long enough that who sits there is a real
 * decision and short enough that a crew with a poor one is inconvenienced rather than locked out.
 * These three numbers were the scout party's clock and spying has always run on it; they moved here
 * when scouting left the game (maintainer, 2026-09-29) and are unchanged.
 */
export const SPY_LOOK_MINUTES_MAX = 240;

/** And the floor, however good the chair is: the best in the game still costs a real evening. */
export const SPY_LOOK_MINUTES_MIN = 40;

/**
 * The sheet total at which the chair is as fast as the floor allows.
 *
 * Read against the *whole* sheet rather than one attribute: casing a place is walking, watching,
 * counting, remembering and not being noticed, and there is no single number for that. A recruit
 * off the Bar sits around 15 an attribute, so a fresh officer totals a few hundred; this is set
 * well above that so a quick chair is something a crew develops rather than something it rolls.
 */
export const SPY_PEAK_TOTAL = 1_400;

/** Every point on the sheet, added. The one figure the look is priced against. */
export function sheetTotal(attributes: Attributes): number {
  return ATTRIBUTE_NAMES.reduce((total, name) => total + attributes[name], 0);
}

/**
 * How long the runners spend on the ground, in minutes, off the Master of Whispers' sheet.
 *
 * Linear between the two bounds, because a curve here would be a balance decision nobody can read
 * off the screen: doubling the sheet should roughly halve the time towards the floor.
 */
export function spyLookMinutesFor(attributes: Attributes): number {
  const share = Math.min(1, Math.max(0, sheetTotal(attributes) / SPY_PEAK_TOTAL));
  const span = SPY_LOOK_MINUTES_MAX - SPY_LOOK_MINUTES_MIN;
  return Math.round(SPY_LOOK_MINUTES_MAX - span * share);
}

/**
 * The whole job, in minutes: there, on the ground, and back.
 *
 * The walk counts **twice**: a look next door is an errand, and the far side of the city costs the
 * crossing at both ends. Every tier takes this same time; the tier moves the price and the report.
 */
export function spyJobMinutes(travelMinutes: number, attributes: Attributes): number {
  return travelMinutes * 2 + spyLookMinutesFor(attributes);
}

export const SpyTargetSchema = z.discriminatedUnion('kind', [
  /** A location in a contested district, whoever holds it. */
  z.object({ kind: z.literal('location'), locationId: IdSchema }),
  /** A player's own district: only its gate can be looked at from outside. */
  z.object({ kind: z.literal('gate'), districtId: IdSchema }),
]);
export type SpyTarget = z.infer<typeof SpyTargetSchema>;

/** Whether two spy jobs look at the same place: one location, or one district's gate. */
export function sameSpyTarget(a: SpyTarget, b: SpyTarget): boolean {
  if (a.kind === 'location' && b.kind === 'location') return a.locationId === b.locationId;
  if (a.kind === 'gate' && b.kind === 'gate') return a.districtId === b.districtId;
  return false;
}

export const SPY_REFUSALS = [
  /**
   * Nobody in the Master of Whispers' chair, which is the whole of the entry price.
   *
   * A rung was here too (`not_researched`). The maintainer's call on 2026-09-22 is the chair
   * alone, so a crew can buy intelligence the moment somebody is sitting in it and before the Lab
   * has finished anything.
   */
  'no_whispers',
  'cannot_afford',
  /** Every party the crew may have out is out (one, or two with Two Sets of Eyes). */
  'already_out',
  /**
   * Runners of this crew are already on their way to this place (maintainer, 2026-10-05): one job
   * per place at a time. Call it off or wait for it to come home.
   */
  'watching_here',
  /** The tier needs a rung the crew has not finished (`SpyTierSpec.opensWith`). */
  'tier_locked',
  /** Nothing to look at: nobody holds it, or it is the crew's own. */
  'nothing_there',
  'own_ground',
  /** A player's district is read at its gate and nowhere else. */
  'not_the_gate',
  /**
   * There is no road between the crew and that ground. Its own refusal because it used to be
   * reported as `no_whispers`, and a player with a Master of Whispers sitting right there would
   * have gone and hired a second one.
   */
  'no_road',
  /** The ground is in a city that is not open yet (`cityIsOpen`): the runners have nowhere to go. */
  'city_closed',
  /**
   * The Curate is alive in that district (`city/combine.ts`): nothing comes out of the Printworks
   * that she has not written. Its own refusal rather than an empty report, because a player who is
   * told "nothing was found" learns the wrong lesson about their runners.
   */
  'only_lies',
] as const;
export type SpyRefusal = (typeof SPY_REFUSALS)[number];

export const SpyRunSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  target: SpyTargetSchema,
  tier: SpyTierSchema,
  /** What was paid at the send. Recorded so the report can say it and a retune cannot move it. */
  capsPaid: z.number().int().nonnegative(),
  departedAt: IsoDateTimeSchema,
  returnsAt: IsoDateTimeSchema,
  /** The way out, frozen at the send: the leg a recall is measured against. */
  travelMinutes: z.number().int().nonnegative(),
  recalledAt: IsoDateTimeSchema.nullable().default(null),
  /**
   * The spying side of the contest, frozen at the send (maintainer, 2026-10-01): benching or
   * swapping the Master of Whispers while the runners are out changes nothing about this job. Null
   * on a run sent before the freeze, which is read off the chair at the settle.
   */
  chairPoints: z.number().nonnegative().nullable().default(null),
  intelPercent: z.number().nullable().default(null),
});
export type SpyRun = z.infer<typeof SpyRunSchema>;

/**
 * A spy job as a screen draws it: the Monitor's row and the district's "somebody is out" line.
 *
 * Named rather than sent as ids, because the Monitor is a page a player reads. The tier and the
 * caps are on it so the row can say what the evening cost.
 */
export const SpyRunViewSchema = z.object({
  id: IdSchema,
  target: SpyTargetSchema,
  districtId: IdSchema,
  districtName: z.string(),
  /** The location's name, or "the gate" for a district read at its door. */
  placeName: z.string(),
  tier: SpyTierSchema,
  capsPaid: z.number().int().nonnegative(),
  departedAt: IsoDateTimeSchema,
  returnsAt: IsoDateTimeSchema,
  travelMinutes: z.number().int().nonnegative(),
  recalledAt: IsoDateTimeSchema.nullable(),
});
export type SpyRunView = z.infer<typeof SpyRunViewSchema>;

/**
 * Who was holding the place when the report was written, as the report says it.
 *
 * Frozen text rather than a base id, because a report is kept for ever and the ground changes
 * hands: "the Combine's, at the Spire" is true of the night the report was written.
 */
export const SpyReportHolderSchema = z.object({
  kind: z.enum(['government', 'looters', 'crew', 'unoccupied']),
  /** The crew's name for a crew, the regime's or the looters' label otherwise. */
  name: z.string(),
  /** The player behind the crew, for a crew. */
  player: z.string().nullable(),
  /** Their faction's name, where they are in one. */
  faction: z.string().nullable(),
});
export type SpyReportHolder = z.infer<typeof SpyReportHolderSchema>;

export const SpyReportSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  target: SpyTargetSchema,
  /** Where it is, as the report heads itself. */
  districtId: IdSchema,
  districtName: z.string(),
  placeName: z.string(),
  holder: SpyReportHolderSchema,
  /**
   * What was bought, or null on the report Turned Runners brings in every day, which nobody paid
   * for and which reads everything (`spying/courier.ts` on the server).
   */
  tier: SpyTierSchema.nullable(),
  capsPaid: z.number().int().nonnegative(),
  writtenAt: IsoDateTimeSchema,
  /** Under `SPY_REPORT_FLOOR`: nothing below is meaningful and the screen says so. */
  failed: z.boolean(),
  /**
   * What the spies were able to uncover. Empty on a failed report, and empty before Written
   * Reports, when a report counts unit slots and names nobody: sent empty rather than hidden by
   * the screen, for the reason `accuracy` gives.
   */
  exposed: ArmySchema,
  /** The unit slots of what was uncovered, which is the whole of a report before Written Reports. */
  exposedSlots: z.number().int().nonnegative().default(0),
  /** Whether `exposed` names the units (Written Reports), frozen at writing time. */
  unitsShown: z.boolean().default(true),
  /**
   * The exact unit slots standing there, from The Whole Wire, whatever the job managed; null
   * without the rung, and on a job kept from looking at all. Countable units only: a Specter is in
   * no report, this one included.
   */
  totalSlots: z.number().int().nonnegative().nullable().default(null),
  /**
   * Whether the holder knows who came (maintainer, 2026-09-28): always before Traffic Analysis,
   * then by the chair's grade. False on ground with nobody to tell.
   */
  foundOut: z.boolean().default(false),
  /**
   * `exposedBodies / countable`, 0..1, rounded by {@link roughAccuracy}. Null where the reader's
   * track does not print it, and on a failed report. Rounded and null rather than exact and merely
   * hidden by the screen: `exposed` divided by the exact figure is the whole count standing there,
   * which is the one thing the report is not meant to say.
   */
  accuracy: z.number().min(0).max(1).nullable(),
  /**
   * The bodies not seen, as the estimate prints them ({@link roughUnseen}). Null where the reader's track does not print one, and on
   * a failed report, where it and the accuracy together would give back what `exposed` withholds.
   * Null from The Whole Wire too, where `totalSlots` says exactly what an estimate would guess at.
   * Frozen at writing time so a rung finished later does not retroactively sharpen an old report.
   */
  unseen: z.number().int().nonnegative().nullable(),
  /** Whether the accuracy figure is printed, frozen the same way. */
  accuracyShown: z.boolean(),
  /**
   * A captured gate held by a crew that lives elsewhere (maintainer, 2026-10-02): nobody stands at
   * it between fights, because the holder brings what they send. The report says that, with no
   * accuracy or estimate, and the battle board quotes no count off it.
   */
  heldFromAway: z.boolean().optional(),
});
export type SpyReport = z.infer<typeof SpyReportSchema>;

/**
 * What a report found, in the few words a headline has room for: "12 seen" once it names units,
 * "18 unit slots seen" before Written Reports, when the slots are all it has.
 */
export function spyReportSummary(
  report: Pick<SpyReport, 'unitsShown' | 'exposed' | 'exposedSlots' | 'heldFromAway'>,
): string {
  if (report.heldFromAway === true) return 'nobody standing there now';
  return report.unitsShown
    ? `${armySize(report.exposed)} seen`
    : `${report.exposedSlots} unit slots seen`;
}

/** What bought a report, as its heading names it: the tier, or the courier's rung for his. */
export function spyReportSource(report: Pick<SpyReport, 'tier'>): string {
  return report.tier === null
    ? (findResearchItem(SPY_COURIER_RESEARCH_ID)?.name ?? 'The courier')
    : SPY_TIER_SPECS[report.tier].label;
}

/**
 * A tenth of the **whole job**, not a tenth of the way out (maintainer, 2026-09-22).
 *
 * `departedAt` to `returnsAt` is the round trip plus the look itself, which is the figure the send
 * dialog quotes and the Monitor counts down, so the window a player is offered is a tenth of the
 * thing they were shown rather than a tenth of a leg nothing on screen names.
 *
 * The note here used to add that the dearest tier spends far longer on the ground than on the
 * road, and that is not true: `SPY_TIER_SPECS` carries a price and a boost and no clock, and
 * `planSpy` takes its minutes from {@link spyJobMinutes}, so every tier takes exactly the same time
 * and only the price and the report differ. The reason above stands on its own; the tiers were never the
 * reason. Corrected 2026-09-25.
 */
function spyTotalMs(run: Pick<SpyRun, 'departedAt' | 'returnsAt'>): number {
  return Math.max(0, Date.parse(run.returnsAt) - Date.parse(run.departedAt));
}

type RecallableSpy = Pick<SpyRun, 'departedAt' | 'returnsAt' | 'recalledAt' | 'travelMinutes'>;

/**
 * When the runners reach the place and take their look.
 *
 * The recall shuts there as well as at the tenth (maintainer, 2026-10-06). A tenth of the whole job
 * outlasts the walk out whenever the look is more than eight times the walk, and a recall after
 * the look threw the read away while a holder who caught them was never told.
 */
function spyArrivesAtMs(run: Pick<SpyRun, 'departedAt' | 'travelMinutes'>): number {
  return Date.parse(run.departedAt) + run.travelMinutes * 60_000;
}

export function spyRecallable(run: RecallableSpy, now: Date): boolean {
  return spyRecallWindowMs(run, now) > 0;
}

export function spyRecallWindowMs(run: RecallableSpy, now: Date): number {
  if (run.recalledAt !== null) return 0;
  const tenth = cancelWindowMs(Date.parse(run.departedAt), spyTotalMs(run), now.getTime());
  return Math.max(0, Math.min(tenth, spyArrivesAtMs(run) - now.getTime()));
}

/** Turned round: home as far off as they had come, and no report. */
export function spyRecalledReturnsAt(
  run: Pick<SpyRun, 'departedAt' | 'travelMinutes'>,
  now: Date,
): Date {
  return new Date(now.getTime() + turnaroundMs(run, now));
}

/** The label a report or a row heads a gate target with. */
export const SPY_GATE_PLACE = 'The gate';
