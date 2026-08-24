import type { Army } from '../units/index.js';
import { luckyFleeChance } from './luck.js';
import type { SideState, Stack } from './engine.js';

/**
 * Who gets away (GDD §A4).
 *
 * The board's rule was a coin flip per body, and the coin flip is still the *base*: what changed
 * is that the sheet now tilts it. A Road Reaver on a bike and a Colossus that walks do not have
 * the same odds of leaving a lost fight, and a system where they do makes speed a stat that only
 * matters on the way in.
 *
 * Four things move it, and all four are things a player chose:
 *
 * - **Speed against the enemy's speed.** Outrunning the pursuit is most of getting clear.
 * - **Stealth.** Not being found is the other way.
 * - **Breaking early.** A stack that routed in round two walked away from a fight that was still
 *   happening; one that held to the end was still standing there when it ended.
 * - **Whose ground it is.** Withdrawing across a district you do not hold costs more.
 * - **The day's luck.** The one thing on this list nobody chose: see `luck.ts`.
 *
 * Clamped at both ends, so no unit is ever certain to escape and none is ever doomed. A certainty
 * either way would collapse the decision it exists to create.
 */

/** The board's coin flip, still the middle of the range. */
export const BASE_FLEE_CHANCE = 0.5;

export const MIN_FLEE_CHANCE = 0.12;
export const MAX_FLEE_CHANCE = 0.88;

/** A full speed advantage over the pursuit is worth this much flee chance. */
export const SPEED_ESCAPE_WEIGHT = 0.3;

/** ...and being unfindable, this much. */
export const STEALTH_ESCAPE_WEIGHT = 0.15;

/** Breaking on the first round rather than the last is worth this much. */
export const EARLY_BREAK_WEIGHT = 0.12;

/** Losing on ground you do not hold costs this much. */
export const AWAY_PENALTY = 0.08;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The fastest thing the other side has on the field: what a withdrawal has to outrun. */
export function pursuitSpeed(enemy: SideState): number {
  return enemy.stacks.reduce(
    (fastest, stack) => (stack.alive > 0 ? Math.max(fastest, stack.effective.speed) : fastest),
    0,
  );
}

export interface FleeContext {
  pursuit: number;
  /** The losing side's luck on the day, in percentage points. See `luck.ts`. */
  luck?: number;
  /** The round the fight ended on, so an early break can be told from a last stand. */
  lastRound: number;
  /** Whether the losing side was the one that came here. */
  away: boolean;
}

export function fleeChance(stack: Stack, context: FleeContext): number {
  const speedEdge = clamp((stack.effective.speed - context.pursuit) / 100, -1, 1);
  const stealth = stack.effective.stealth / 100;
  const brokeAt = stack.brokeAt ?? context.lastRound;
  const early = context.lastRound <= 1 ? 0 : 1 - (brokeAt - 1) / Math.max(1, context.lastRound - 1);

  return clamp(
    BASE_FLEE_CHANCE +
      SPEED_ESCAPE_WEIGHT * speedEdge +
      STEALTH_ESCAPE_WEIGHT * stealth +
      EARLY_BREAK_WEIGHT * early +
      luckyFleeChance(context.luck ?? 0) -
      (context.away ? AWAY_PENALTY : 0),
    MIN_FLEE_CHANCE,
    MAX_FLEE_CHANCE,
  );
}

/**
 * Splits the losing side into those who ran and those who did not.
 *
 * Rolled per *individual*, not per stack: one roll for a stack of twenty would mean twenty Razors
 * all live or all die, which is a very different game from the one the numbers describe. Draws come
 * from the shared stream, so the whole fight is still one seed.
 */
export function routSurvivors(
  losing: SideState,
  context: FleeContext,
  next: () => number,
): { fled: Army; killed: Army } {
  const fled: Army = {};
  const killed: Army = {};

  for (const stack of losing.stacks) {
    // Everything that fell during the fight is already dead; only the standing get a roll.
    const dead = stack.started - stack.alive;
    if (dead > 0) killed[stack.unit.id] = (killed[stack.unit.id] ?? 0) + dead;

    const chance = fleeChance(stack, context);
    let ran = 0;
    for (let i = 0; i < stack.alive; i += 1) if (next() < chance) ran += 1;
    if (ran > 0) fled[stack.unit.id] = (fled[stack.unit.id] ?? 0) + ran;
    const caught = stack.alive - ran;
    if (caught > 0) killed[stack.unit.id] = (killed[stack.unit.id] ?? 0) + caught;
  }

  return { fled, killed };
}

/** What the winning side lost. Every body that fell is gone; the standing ones simply stand. */
export function winnerCasualties(winning: SideState): Army {
  const killed: Army = {};
  for (const stack of winning.stacks) {
    const dead = stack.started - stack.alive;
    if (dead > 0) killed[stack.unit.id] = dead;
  }
  return killed;
}
