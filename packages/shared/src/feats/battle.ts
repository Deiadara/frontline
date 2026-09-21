import type { FeatMeasure } from './measures.js';

/**
 * Which of the seven "that one was worth telling somebody about" counters a fight earns.
 *
 * ## Why the rule lives in shared rather than at the settle site
 *
 * The server knows what happened; it should not also be the thing that decides what counts as
 * winning against the odds. Four thresholds written into `battle/resolve.ts` would be four numbers
 * nobody could test without a database, sitting a long way from the blurbs that promise them, and
 * the blurbs are the contract: "beat a line twice your own" has to mean the same thing on the
 * board as it does in the settler. One pure function over five numbers is testable on its own and
 * is the only place the thresholds are written down.
 *
 * ## Force is counted in the unit slots that stand in the line
 *
 * Slots rather than heads, because a Juggernaut is not one body and the game already prices a
 * force by the beds it needs everywhere else it matters: housing, the deployment screen and
 * `supply_deployed`. Counting heads would make "outnumbered" a statement about how cheap the
 * other crew's units were, so a crew could farm the ladder by walking a maxed line into a mob of
 * Razors.
 *
 * ...and only the slots that will actually be *in* the fight, which is `fightingSlots` in
 * `battle/line.ts`. That half was missing until 2026-09-18 and it was the larger error of the
 * two: a crew defends its home with its whole roster, so the warehouse staff were counted as a
 * defence. See the measurement there.
 */

/** How much bigger the other line has to be before a win counts as one against the odds. */
export const OUTNUMBERED_AT = 2;

/** ...and before it counts as the kind nobody expected. */
export const OVERWHELMED_AT = 4;

/**
 * How well a winner has to trade for the win to count as a rout, and the floor under it.
 *
 * Both halves are needed. The ratio alone makes a fight where one Razor died and eleven of theirs
 * did a "ten to one rout", which is a skirmish; the floor alone would pay out for any big win
 * however expensive it was. Ten of theirs for one of yours, and at least ten of theirs.
 */
export const LOPSIDED_AT = 10;

/**
 * How hard a crew's jammers have to be working for the fight to be worth a counter.
 *
 * Half of {@link MAX_JAM}, which is the figure a line that is a full quarter jammers reaches in
 * nominal conditions. Half of it is about an eighth of the line given over to Netrunners: a real
 * decision about what you brought, and well clear of one of them tagging along. The ground moves
 * the jam either way (`jamCondition`), so the same force can clear this in a crammed cellar and
 * miss it in the open, which is the mechanic working rather than a wobble in the feat.
 */
export const JAMMING_AT = 20;

/** One crew's side of a settled fight, in the numbers the counters are decided on. */
export interface BattleFeatFacts {
  /** Whether this crew was on the winning side. Nothing below is earned by losing. */
  readonly won: boolean;
  /** Unit slots this crew's side had on the ground at the mark. */
  readonly ownForce: number;
  /** ...and what stood against it. */
  readonly enemyForce: number;
  /** Units this side took off the other, counting the trap and the ring. */
  readonly killed: number;
  /** ...and units of its own that did not walk off the field. */
  readonly lost: number;
  /**
   * §E: what this crew's jammers laid on the other side as the lines formed, in percentage
   * points (`UnitSpec.jammer`, `openingJam`).
   *
   * Zero for every crew that brought none, which is almost all of them. The opening figure and
   * not the closing one, so a crew is paid for what it committed rather than punished for the
   * enemy killing it.
   */
  readonly jam: number;
  /**
   * §A4: whether this crew had Sleepers already on the ground when it called the fight
   * (`UnitSpec.sleeper`, `city/sleepers.ts`).
   *
   * A fact about the *setup*, not about the fight: the cell was planted days earlier and woke
   * into the deployment at the declaration. False for everybody who simply sent Sleepers to a
   * fight the ordinary way, which is the distinction the ladder is about.
   */
  readonly planted: boolean;
  /**
   * §A5: whether this crew fought the racket into the other side (`UnitSpec.loud`).
   *
   * The Anodics, and a fact about what was *brought* rather than about how it went: the label
   * goes onto the enemy's ground the moment the lines form, and what it costs them is decided
   * by their own sheets (`loudGround`). False for the great majority of fights, which is what
   * makes the ladder worth climbing.
   */
  readonly loud: boolean;
}

/**
 * The counters this fight earns for one crew, in catalogue order.
 *
 * A fight can earn several: a win at four to one is also a win at two to one, and a rout the
 * winner walked away from whole is both flawless and lopsided. That is the same relation
 * `battles_won` already has with `battles_fought`, and the ladders are separate chains, so every
 * one of them ticks.
 *
 * Both force tests want a real enemy on the ground. An unoccupied lot has nobody on it, and a
 * walkover that paid out a flawless win every time would make the ladder a measure of how much of
 * the map is empty.
 */
export function battleFeatsEarned(facts: BattleFeatFacts): FeatMeasure[] {
  if (!facts.won) return [];
  const earned: FeatMeasure[] = [];
  const contested = facts.ownForce > 0 && facts.enemyForce > 0;

  if (contested && facts.enemyForce >= facts.ownForce * OUTNUMBERED_AT) {
    earned.push('battles_won_outnumbered');
  }
  if (contested && facts.enemyForce >= facts.ownForce * OVERWHELMED_AT) {
    earned.push('battles_won_overwhelmed');
  }
  if (facts.enemyForce > 0 && facts.lost === 0) earned.push('battles_won_flawless');
  if (facts.killed >= LOPSIDED_AT && facts.killed >= facts.lost * LOPSIDED_AT) {
    earned.push('battles_won_lopsided');
  }
  // §E: a win the Netrunners were a real part of. No `contested` clause, because a jam needs an
  // enemy to be laid on and `openingJam` is zero on a walkover for the same reason.
  if (facts.jam >= JAMMING_AT) earned.push('battles_won_jamming');
  /*
   * §A4: a win on ground this crew had already infiltrated.
   *
   * `contested`, unlike the jam: a cell woken onto an empty lot is a walk-in rather than a plan
   * coming off, and the ladder would otherwise be a measure of how much of the map is unheld.
   */
  if (contested && facts.planted) earned.push('battles_won_planted');
  /*
   * §A5: a win fought on ground this crew made unbearable.
   *
   * `contested` like the cell and unlike the jam, and for the same reason: a din laid on nobody
   * is not a tactic, and without the clause the chain would count empty lots.
   */
  if (contested && facts.loud) earned.push('battles_won_loud');
  return earned;
}
