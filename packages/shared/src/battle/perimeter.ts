import { findUnit, type Army } from '../units/index.js';
import { simulate, type SideState, type Simulation } from './engine.js';
import { pursuitSpeed, routSurvivors, winnerCasualties, type FleeContext } from './rout.js';

/**
 * The ring around the fight (GDD §A4, battle rework).
 *
 * A second force, chosen before the mark and standing outside the battle proper. It never joins the
 * line and never appears in the round loop. What it does is stop people leaving: anybody breaking
 * out of the fight, and anybody being quietly pulled back out of a deployment before the fight
 * starts.
 *
 * ## Why anybody would field one
 *
 * Not for the kills. A perimeter is an **intelligence weapon**: the losing side only ever learns
 * what happened from the people who walked home, so a ring that catches all of them means the enemy
 * gets a silence where their report should be (`battle/analysis.ts` enforces exactly that). It costs
 * you units that could have been in the line: the trade is bodies now against the other side
 * planning blind next time, which is the decision the whole mechanic exists to create.
 *
 * ## The rule that makes it a gamble
 *
 * **A losing side's perimeter never fights.** The board's rule, and it is the right one: the ring is
 * outside the battle, so when the line inside it collapses there is nothing for the ring to do and
 * it walks away intact. So a perimeter is a gamble on winning, and every body in it is a body that
 * was not helping you win.
 *
 * ## What meeting the ring actually is
 *
 * A **second battle**, on the same ground, under the same rules as the first: the runners attack and
 * the ring defends. It used to be a catch-rate, a per-runner roll against how thick the ring was,
 * and the two models answer very differently. A toll cannot be lost. A ring of four could not be
 * overrun by two hundred people coming through it, it simply caught its 85 percent ceiling of them
 * and took no casualties doing it, so a perimeter was free once you had won and its size only ever
 * changed how much it collected.
 *
 * That is the **breakout**, and it is what this module is mostly about. The other thing a ring does,
 * catching people quietly pulled out of a deployment before the fight, is still a toll and still
 * costs the ring nothing: see {@link perimeterToll} for why those two are not the same model.
 *
 * Now a breakout is a fight, so:
 *
 * - The ring can be **broken through**, and a thin one in front of a mass breakout will be.
 * - The ring **takes casualties**. Standing in front of desperate people costs bodies.
 * - The runners who lose that fight get a second rout roll, on the same sheets and the same four
 *   things that decide the first one, so a Road Reaver is still hard to bottle up.
 *
 * That last roll is the one place the rules are not identical, and deliberately: see
 * {@link PERIMETER_FLEE_PENALTY}.
 */

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * How much of the ring is real, in bodies.
 *
 * Counted rather than weighted by sheet: standing on a road at night is a job a Razor does about as
 * well as a Sniper, and making the ring scale with offense would turn "deny them a report" into
 * "bring your best units and do it twice".
 */
export function perimeterBodies(perimeter: Army): number {
  return Object.entries(perimeter).reduce(
    (sum, [unitId, count]) => (findUnit(unitId) ? sum + Math.max(0, count) : sum),
    0,
  );
}

/**
 * How many runners one body on the ring can realistically cover, when it is picking off a quiet
 * withdrawal rather than fighting a breakout.
 *
 * Above one because spotting people leaving is not a duel: somebody watching a road stops several
 * over the course of an evening. Not much above one, because a thin ring around a mass exit is a
 * formality.
 */
export const RUNNERS_COVERED_PER_BODY = 1.5;

/** The most of a withdrawal a ring can ever take this way. Nothing is airtight. */
export const MAX_PERIMETER_CATCH = 0.85;

/**
 * How much a runner's own speed and stealth are worth against the ring.
 *
 * The two stats that already decide who gets away from a lost fight (`rout.ts`), read the same way
 * here so a Road Reaver is hard to bottle up for the same reason it is hard to run down. Weighted
 * below one so no sheet makes a unit uncatchable.
 */
export const PERIMETER_EVASION_WEIGHT = 0.6;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** The share of a withdrawal the ring is thick enough to reach at all, 0..1. */
export function ringCoverage(perimeter: Army, runners: number): number {
  if (runners <= 0) return 0;
  return clamp((perimeterBodies(perimeter) * RUNNERS_COVERED_PER_BODY) / runners, 0, 1);
}

/** One runner's odds of being stopped, given how thick the ring is where they hit it. */
export function catchChance(unitId: string, coverage: number): number {
  const unit = findUnit(unitId);
  if (!unit) return 0;
  const slipperiness = ((unit.stats.speed + unit.stats.stealth) / 200) * PERIMETER_EVASION_WEIGHT;
  return clamp(MAX_PERIMETER_CATCH * coverage * (1 - slipperiness), 0, MAX_PERIMETER_CATCH);
}

export interface PerimeterToll {
  /** Runners the ring stopped. Dead, and they carry no report home. */
  caught: Army;
  /** Runners who got past it. */
  escaped: Army;
}

/**
 * What a ring takes out of a crew being quietly pulled back out of a deployment, before any fight.
 *
 * **Not** the breakout: see {@link breakOut} for what happens to people leaving a fight they lost.
 * The two are separate models on purpose, and the difference is what the runners are doing rather
 * than a simplification.
 *
 * Meeting a ring on the way out of a lost battle is a battle, because both sides are already
 * committed and there is nothing left to lose by riding through. Sneaking units out of a deployment
 * days beforehand is not: nobody is committed to anything, and a player who could start a real fight
 * by withdrawing would withdraw one body at a time and farm the enemy's ring to nothing for free,
 * one cheap request each. So this stays a toll, and a toll costs the ring nothing.
 *
 * Rolled per individual off the passed stream. An empty ring returns the withdrawal untouched
 * **without drawing**.
 */
export function perimeterToll(fleeing: Army, perimeter: Army, next: () => number): PerimeterToll {
  const runners = total(fleeing);
  const coverage = ringCoverage(perimeter, runners);
  if (coverage <= 0 || runners === 0) return { caught: {}, escaped: { ...fleeing } };

  const caught: Army = {};
  const escaped: Army = {};
  for (const [unitId, count] of Object.entries(fleeing)) {
    if (count <= 0) continue;
    const chance = catchChance(unitId, coverage);
    let stopped = 0;
    for (let i = 0; i < count; i += 1) if (next() < chance) stopped += 1;
    if (stopped > 0) caught[unitId] = stopped;
    if (count - stopped > 0) escaped[unitId] = count - stopped;
  }
  return { caught, escaped };
}

/**
 * How much harder it is to get past a ring than to walk away from the fight it surrounds.
 *
 * A multiplier on the finished flee chance, applied by {@link FleeContext.hardship}. Half, because
 * the two withdrawals are not the same problem: the first is from a fight that has stopped paying
 * attention to you, and the second is through people who are standing there for no other reason
 * than to stop you. Everything else about the roll is unchanged, so speed, stealth, the day's luck
 * and how early the stack broke all still decide who gets clear.
 */
export const PERIMETER_FLEE_PENALTY = 0.5;

export interface BreakoutInput {
  /** Who is coming out of the lost fight, after the first rout roll. */
  fleeing: Army;
  /** The winner's ring. The loser's never fights: see {@link perimeterFights}. */
  ring: Army;
  /** The same ground the first fight was on. Omitted is open ground, as it is for `simulate`. */
  battlefield?: Simulation['battlefield'];
  /** The parent fight's seed. The second battle takes its own stream off a suffix of it. */
  seed: string;
  /** The rout context of the fight they are running from, so the same sheets still matter. */
  context: FleeContext;
}

export interface Breakout {
  /** Runners who got clear. They go home and they carry the report. */
  escaped: Army;
  /** Runners the ring stopped, whether in the fight or on the second break. Dead. */
  caught: Army;
  /** What the ring paid to stop them. */
  ringLosses: Army;
  /** Whether the runners came through the line rather than being turned back by it. */
  brokeThrough: boolean;
  /** Rounds the second fight took. Zero when there was no ring and no fight. */
  rounds: number;
}

/** Everybody still on their feet, as an army. */
function standing(side: SideState): Army {
  const army: Army = {};
  for (const stack of side.stacks) {
    if (stack.alive > 0) army[stack.unit.id] = (army[stack.unit.id] ?? 0) + stack.alive;
  }
  return army;
}

/**
 * The runners against the ring.
 *
 * An empty ring, or nobody running, returns the withdrawal untouched **and draws nothing**, so a
 * battle nobody set a perimeter for produces the identical stream it always did. Every engine test
 * pinned to a number depends on that.
 */
export function breakOut(input: BreakoutInput, next: () => number): Breakout {
  const clear = (): Breakout => ({
    escaped: { ...input.fleeing },
    caught: {},
    ringLosses: {},
    brokeThrough: true,
    rounds: 0,
  });
  if (total(input.fleeing) === 0 || perimeterBodies(input.ring) === 0) return clear();

  // The runners attack, because they are the ones who need to be somewhere else, and the ring
  // defends, because it chose this ground before the first fight started.
  const second = simulate({
    seed: `${input.seed}:ring`,
    // Spread rather than assigned: `exactOptionalPropertyTypes` refuses an explicit `undefined` for
    // an optional property, and open ground is the absence of the key rather than an undefined one.
    ...(input.battlefield ? { battlefield: input.battlefield } : {}),
    attacker: { name: 'the withdrawal', army: input.fleeing, defending: false },
    defender: { name: 'the ring', army: input.ring, defending: true },
  });
  const ringLosses = winnerCasualties(second.defender);
  const rounds = second.rounds.length;

  if (second.winner === 'attacker') {
    // Through it. Whoever is still standing is on their way home, and the rest fell doing it.
    return {
      escaped: standing(second.attacker),
      caught: winnerCasualties(second.attacker),
      ringLosses,
      brokeThrough: true,
      rounds,
    };
  }

  /*
   * The ring held, so they break a second time.
   *
   * The context is the parent fight's, so the day's luck and whose ground it is still apply, with
   * three things replaced: the pursuit is the ring's own speed, the round is this fight's, and the
   * chance is halved. `routSurvivors` counts everybody who fell in the fight as killed as well as
   * everybody caught running, so `killed` is the whole of what the ring took.
   */
  const { fled, killed } = routSurvivors(
    second.attacker,
    {
      ...input.context,
      pursuit: pursuitSpeed(second.defender),
      lastRound: rounds,
      hardship: PERIMETER_FLEE_PENALTY,
    },
    next,
  );
  return { escaped: fled, caught: killed, ringLosses, brokeThrough: false, rounds };
}

/**
 * Whether a side's ring is allowed to do anything at all.
 *
 * The losing side's is not. Stated as a named predicate rather than an `if` inside the resolver
 * because it is the single rule people get wrong when reading the feature back, and a function with
 * this name in a stack trace explains itself.
 */
export function perimeterFights(side: 'attacker' | 'defender', winner: 'attacker' | 'defender') {
  return side === winner;
}
