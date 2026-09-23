import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { ArmySchema, type Army } from '../units/index.js';
import { cancelWindowMs, cancelWindowOpen, turnaroundMs } from '../time/cancel.js';

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
 * The other side is whoever holds the place. A crew's Consigliere, their fit for *that* chair,
 * plus their counter-intel bonuses, plus the gate on a player's district or on a district they
 * hold whole. Looter and Combine ground carry no chair, so they carry flat points off the district's
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
}

export const SPY_TIER_SPECS: Readonly<Record<SpyTier, SpyTierSpec>> = {
  loose_ears: {
    label: 'Loose Ears',
    caps: 100,
    boost: 0,
    blurb: 'A drink for whoever talks. Somebody usually does.',
  },
  paid_whisper: {
    label: 'Paid Whisper',
    caps: 500,
    boost: 0.4,
    blurb: 'One person on the inside, paid to say what they see.',
  },
  bought_eyes: {
    label: 'Bought Eyes',
    caps: 2000,
    boost: 1.2,
    blurb: 'A watcher on the roof opposite for as long as it takes.',
  },
  network_compromise: {
    label: 'Network Compromise',
    caps: 5000,
    boost: 1.6,
    blurb: 'Their own runners carrying your questions along with their messages.',
  },
  total_intelligence: {
    label: 'Total Intelligence',
    caps: 10000,
    boost: 2.6,
    blurb: 'Everyone who can be bought, bought at once. There is nothing left to hide behind.',
  },
};

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
 * Looter and Combine ground carry no Consigliere. They carry the district's difficulty and the
 * location's own defence instead, and the Combine's regime a good deal more of both: a Combine
 * district is meant to be an event to read, the way it is an event to enter.
 */
export const SPY_NPC_BASE_POINTS = { looters: 6, government: 22 } as const;
export const SPY_NPC_DIFFICULTY_POINTS = { looters: 3, government: 5 } as const;
export const SPY_NPC_DEFENSE_SHARE = { looters: 0.15, government: 0.3 } as const;

export interface SpyStrength {
  /** The Master of Whispers' fit for the chair, as points: 10..100. */
  chairPoints: number;
  /** Every intel bonus the crew holds, as points. */
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
      /** Their Consigliere's fit for that chair, or null with nobody in it. */
      consigliereChairPoints: number | null;
      /** Their counter-intel bonuses, as points. */
      intelResistancePercent: number;
      /** The gate over the place: their district's own, or the captured gate on ground held whole. */
      gateLevel: number;
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
    return (
      Math.max(0, counter.consigliereChairPoints ?? 0) +
      Math.max(0, counter.intelResistancePercent) +
      Math.max(0, counter.gateLevel) * SPY_GATE_POINTS_PER_LEVEL
    );
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

export interface ExposureInput {
  /** Who is there. */
  army: Army;
  /** The unit's stealth as it stands on that ground, bonuses in. */
  stealthOf: (unitId: string) => number;
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
  /** `exposedBodies / countable`, 0..1. One on empty ground: there was nothing to miss. */
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
 * Whole units in a stack are taken in stealth order, then id order, so the walk is deterministic
 * and two reports on the same ground with the same budget read the same. A stack the budget runs
 * out inside is reported as far as it reached: seeing six of ten Razors is a fact, not a guess.
 */
export function expose({ army, stealthOf, visible, budget }: ExposureInput): Exposure {
  const stacks = Object.entries(army)
    .filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0 && visible(entry[0]))
    .sort(([a], [b]) => stealthOf(a) - stealthOf(b) || a.localeCompare(b));
  const countable = stacks.reduce((total, [, count]) => total + count, 0);
  const exposed: Army = {};
  let exposedBodies = 0;
  let left = Math.max(0, budget);
  for (const [unitId, count] of stacks) {
    const cost = bodyCost(stealthOf(unitId));
    const seen = Math.min(count, Math.floor(left / cost + 1e-9));
    if (seen <= 0) break;
    exposed[unitId] = seen;
    exposedBodies += seen;
    left -= seen * cost;
  }
  return {
    exposed,
    exposedBodies,
    countable,
    accuracy: countable === 0 ? 1 : exposedBodies / countable,
    unseen: countable - exposedBodies,
  };
}

/** Whether a report at this accuracy is a report at all. */
export function spyReportStands(accuracy: number): boolean {
  return accuracy >= SPY_REPORT_FLOOR;
}

// --- the job on the clock ---

export const SpyTargetSchema = z.discriminatedUnion('kind', [
  /** A location in a contested district, whoever holds it. */
  z.object({ kind: z.literal('location'), locationId: IdSchema }),
  /** A player's own district: only its gate can be looked at from outside. */
  z.object({ kind: z.literal('gate'), districtId: IdSchema }),
]);
export type SpyTarget = z.infer<typeof SpyTargetSchema>;

export const SPY_REFUSALS = [
  /**
   * Nobody in the Master of Whispers' chair, which is the whole of the entry price.
   *
   * A rung was here too (`not_researched`): spying was gated on Scouting the way a scout party
   * is. The maintainer's call on 2026-09-22 is the chair alone, so a crew can buy intelligence
   * the moment somebody is sitting in it and before the Lab has finished anything.
   */
  'no_whispers',
  'cannot_afford',
  /** One job at a time: the runners are already out on another. */
  'already_out',
  /** Nothing to look at: nobody holds it, or it is the crew's own. */
  'nothing_there',
  'own_ground',
  /** A player's district is read at its gate and nowhere else. */
  'not_the_gate',
  'unscouted',
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
  /** The way out, frozen at the send: the leg a recall is measured against, as a scout's is. */
  travelMinutes: z.number().int().nonnegative(),
  recalledAt: IsoDateTimeSchema.nullable().default(null),
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
  tier: SpyTierSchema,
  capsPaid: z.number().int().nonnegative(),
  writtenAt: IsoDateTimeSchema,
  /** Under `SPY_REPORT_FLOOR`: nothing below is meaningful and the screen says so. */
  failed: z.boolean(),
  /** What the spies were able to uncover. Empty on a failed report. */
  exposed: ArmySchema,
  /** `exposedBodies / countable`, 0..1. Printed only where the reader's track allows. */
  accuracy: z.number().min(0).max(1),
  /**
   * The bodies not seen, for the estimate. Null where the reader's track does not print one, and
   * frozen at writing time so a rung finished later does not retroactively sharpen an old report.
   */
  unseen: z.number().int().nonnegative().nullable(),
  /** Whether the accuracy figure is printed, frozen the same way. */
  accuracyShown: z.boolean(),
});
export type SpyReport = z.infer<typeof SpyReportSchema>;

/**
 * A tenth of the **whole job**, not a tenth of the way out (maintainer, 2026-09-22).
 *
 * `departedAt` to `returnsAt` is the round trip plus the look itself, which is the figure the
 * send dialog quotes and the Monitor counts down. Measuring the outbound leg alone gave a window
 * that shrank as the tier grew: `total_intelligence` spends far longer on the ground than on the
 * road, so the dearest job in the game was the one a player had least time to call off.
 */
function spyTotalMs(run: Pick<SpyRun, 'departedAt' | 'returnsAt'>): number {
  return Math.max(0, Date.parse(run.returnsAt) - Date.parse(run.departedAt));
}

type RecallableSpy = Pick<SpyRun, 'departedAt' | 'returnsAt' | 'recalledAt'>;

export function spyRecallable(run: RecallableSpy, now: Date): boolean {
  if (run.recalledAt !== null) return false;
  return cancelWindowOpen(Date.parse(run.departedAt), spyTotalMs(run), now.getTime());
}

export function spyRecallWindowMs(run: RecallableSpy, now: Date): number {
  if (run.recalledAt !== null) return 0;
  return cancelWindowMs(Date.parse(run.departedAt), spyTotalMs(run), now.getTime());
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
