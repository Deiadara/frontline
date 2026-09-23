import { z } from 'zod';
import { FeatMeasureSchema, featValue, type FeatSnapshot } from './measures.js';
import { FeatEraSchema, FeatRewardSchema, FeatSizeSchema, type FeatReward } from './rewards.js';

/**
 * One feat: a threshold on a measure, and what finishing it pays.
 *
 * ## Chains, and the maintainer's rule about locking
 *
 * "Have the only ones that are locked those that are totally ordered." A feat either stands alone,
 * in which case it is always visible and always attemptable, or it sits in a **chain** where every
 * step asks the same question with a bigger number: field a hundred units, then five hundred,
 * then two thousand. In a chain the later steps are locked until the earlier one is done, and that
 * is the only kind of locking in the system.
 *
 * The reason to lock those and nothing else is that they are the one case where showing the later
 * step tells a player nothing they cannot already work out. A crew looking at "field 100" knows
 * there will be a bigger one. A wall of eight tiers of the same sentence is not information, it is
 * the screen shouting; one tier at a time is a ladder.
 *
 * `after` is the previous step's id rather than a `step` number plus a lookup, because it makes
 * the ordering explicit in the data: a chain with a gap in it, or a cycle, is caught by
 * `catalog.test.ts` reading this field and nothing else.
 */
export const FeatSpecSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What to do, in one line, in the player's words. Never a restatement of the measure. */
  blurb: z.string().min(1),
  era: FeatEraSchema,
  size: FeatSizeSchema,
  /** The chain this belongs to, or null for a feat that stands alone and never locks. */
  chain: z.string().min(1).nullable(),
  /** The step before this one. Null for the first step of a chain and for a standalone feat. */
  after: z.string().min(1).nullable(),
  measure: FeatMeasureSchema,
  /** Set exactly when the measure is scoped. See `featMeasureKey`. */
  scope: z.string().min(1).optional(),
  target: z.number().positive(),
  reward: FeatRewardSchema,
});
export type FeatSpec = z.infer<typeof FeatSpecSchema>;

/** Where a feat stands for one crew, which is the whole of what the screen draws. */
export const FEAT_STATES = ['locked', 'open', 'ready', 'claimed'] as const;
export const FeatStateSchema = z.enum(FEAT_STATES);
export type FeatState = z.infer<typeof FeatStateSchema>;

export const FeatProgressSchema = z.object({
  id: z.string().min(1),
  state: FeatStateSchema,
  /** Where the crew stands on this feat's measure, clamped to the target. */
  value: z.number().nonnegative(),
  target: z.number().positive(),
  /** `value / target`, 0 to 1. Computed here so two screens cannot round it differently. */
  progress: z.number().min(0).max(1),
});
export type FeatProgress = z.infer<typeof FeatProgressSchema>;

/**
 * How a feat stands, given what the crew has done and what it has already claimed.
 *
 * Pure, and takes the two things it needs rather than a crew: the evaluator is the piece most
 * worth testing exhaustively and a function of two plain records can be.
 *
 * ## Why achievement is separate from claiming
 *
 * A feat is **achieved** the moment the number is reached, whether or not anybody is looking. It
 * becomes **claimed** only when the player presses the button. Keeping those apart is what lets
 * the badge say "three waiting" and what stops a reward being paid to a tab that happened to poll.
 *
 * It also decides what unlocks the next step in a chain, and the answer is **achievement, not
 * claiming**. A player who finishes tier one and never presses the button still gets tier two,
 * because the alternative is a ladder that silently stops for somebody who did the work. The cost
 * is that a crew far enough along can unlock a whole chain at once, which is the right outcome:
 * arriving at the feats screen at level 40 should hand over the early ladder, not make somebody
 * click through it one poll at a time.
 */
export function featState(
  spec: FeatSpec,
  snapshot: FeatSnapshot,
  claimed: ReadonlySet<string>,
  achievedBefore: (featId: string) => boolean,
): FeatProgress {
  const value = featValue(snapshot, spec.measure, spec.scope);
  const progress = Math.min(1, value / spec.target);
  const done = value >= spec.target;

  if (claimed.has(spec.id)) {
    /*
     * Clamped, like the open and ready rows below it, because a measure keeps moving after the
     * button is pressed. Left raw, a crew that collected "write one letter" and then wrote three
     * hundred read `300 / 1 letters` on a collected rung, which is the screen reporting a fraction
     * nobody can make sense of. `FeatProgress.value` says "clamped to the target" and this is the
     * one branch that was not.
     */
    return {
      id: spec.id,
      state: 'claimed',
      value: Math.min(value, spec.target),
      target: spec.target,
      progress: 1,
    };
  }
  if (spec.after !== null && !achievedBefore(spec.after)) {
    /*
     * A locked feat reports no progress at all, and that is deliberate.
     *
     * Reporting the real figure would leak the next rung's number to a screen that is not drawing
     * it, and, worse, would make a locked row show a full bar: a crew fielding two thousand units
     * has met every tier of that chain, so tier four would sit there complete and unclaimable
     * looking like a bug. Zero on a locked row reads as "not yet", which is what it is.
     */
    return { id: spec.id, state: 'locked', value: 0, target: spec.target, progress: 0 };
  }
  return {
    id: spec.id,
    state: done ? 'ready' : 'open',
    value: Math.min(value, spec.target),
    target: spec.target,
    progress,
  };
}

/**
 * Every feat's standing, in catalogue order.
 *
 * One pass, and it works because the catalogue is ordered so that a chain's steps come in order
 * (`catalog.test.ts` enforces it). That means a step's predecessor has already been decided by the
 * time this reaches it, so a whole chain resolves in one sweep rather than needing a fixed point.
 */
export function evaluateFeats(
  catalog: readonly FeatSpec[],
  snapshot: FeatSnapshot,
  claimed: ReadonlySet<string>,
): FeatProgress[] {
  const achieved = new Map<string, boolean>();
  return catalog.map((spec) => {
    const progress = featState(spec, snapshot, claimed, (id) => achieved.get(id) ?? false);
    // Claimed counts as achieved: a chain must not stall because its first step was collected.
    achieved.set(spec.id, progress.state === 'ready' || progress.state === 'claimed');
    return progress;
  });
}

/** How many feats are finished and waiting to be collected. The number in the red square. */
export function readyCount(progress: readonly FeatProgress[]): number {
  return progress.filter((one) => one.state === 'ready').length;
}

/**
 * Whether this feat may be collected right now, for the route that pays it out.
 *
 * The server asks this rather than trusting the client's view of the same question, which is the
 * whole reason it is a named function: a claim arriving for a locked feat, an unfinished one, or
 * one already collected is the same refusal, and there is one place that decides it.
 */
export function canClaimFeat(progress: FeatProgress | undefined): boolean {
  return progress?.state === 'ready';
}

/**
 * The rewards of a set of feats, added together.
 *
 * Used by the claim-everything path and by the test that prices a whole chain. Written as a fold
 * over the same six channels `FeatReward` has, so a seventh channel added there and forgotten here
 * is a type error rather than a reward that silently never arrives.
 */
export function mergeFeatRewards(rewards: readonly FeatReward[]): FeatReward {
  const merged: {
    resources: Record<string, number>;
    items: Record<string, number>;
    units: Record<string, number>;
    xp: number;
    infamy: number;
    boosts: string[];
  } = { resources: {}, items: {}, units: {}, xp: 0, infamy: 0, boosts: [] };

  for (const reward of rewards) {
    for (const [key, amount] of Object.entries(reward.resources ?? {})) {
      merged.resources[key] = (merged.resources[key] ?? 0) + (amount ?? 0);
    }
    for (const [key, amount] of Object.entries(reward.items ?? {})) {
      merged.items[key] = (merged.items[key] ?? 0) + (amount ?? 0);
    }
    for (const [key, amount] of Object.entries(reward.units ?? {})) {
      merged.units[key] = (merged.units[key] ?? 0) + (amount ?? 0);
    }
    merged.xp += reward.xp ?? 0;
    merged.infamy += reward.infamy ?? 0;
    merged.boosts.push(...(reward.boosts ?? []));
  }

  return {
    ...(Object.keys(merged.resources).length > 0 ? { resources: merged.resources } : {}),
    ...(Object.keys(merged.items).length > 0 ? { items: merged.items } : {}),
    ...(Object.keys(merged.units).length > 0 ? { units: merged.units } : {}),
    ...(merged.xp > 0 ? { xp: merged.xp } : {}),
    ...(merged.infamy > 0 ? { infamy: merged.infamy } : {}),
    ...(merged.boosts.length > 0 ? { boosts: merged.boosts } : {}),
  };
}
