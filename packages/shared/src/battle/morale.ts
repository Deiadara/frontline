import { z } from 'zod';

/**
 * Whether a stack is still fighting (GDD §A5).
 *
 * Modelled on Total War's ladder rather than on a hit-point bar, because the interesting thing
 * about morale is not that it runs out. It is that it runs out *faster the lower it already is*.
 * A steady unit absorbs a bad round. A shaken one compounds it. That single non-linearity is what
 * makes intimidation a strategy instead of a stat, and it is the mechanism behind the brief:
 * intimidation works on low morale.
 *
 * Rout is a one-way door within a fight. A stack that breaks stops contributing offense, takes
 * pursuit damage while it disengages, and drags its neighbours down with it: the cascade that
 * turns a bad round into a collapse.
 */

export const MORALE_STATES = ['steady', 'shaken', 'wavering', 'routed'] as const;
export const MoraleStateSchema = z.enum(MORALE_STATES);
export type MoraleState = z.infer<typeof MoraleStateSchema>;

/** Thresholds, high to low. A stack is in the first state whose floor it still clears. */
export const MORALE_THRESHOLDS: Record<Exclude<MoraleState, 'routed'>, number> = {
  steady: 60,
  shaken: 35,
  wavering: 15,
};

/**
 * What each rung of the ladder costs a stack in fire (maintainer, 2026-09-21).
 *
 * The ladder had four names and one consequence: nothing happened until `routed`. That made
 * morale a clock rather than a stat. `WINNING_RELIEF` zeroes the casualty shock for whichever
 * side is winning the exchange, so morale decided only how long the losing side lasted and never
 * who lost, and measured against the other seven ratings it was worth a third of armour. A shaken
 * line now fires at nine tenths and a wavering one at seven tenths, which is what those words mean
 * in every wargame that uses them, and it is what lets a steadier line win an exchange it would
 * otherwise have lost.
 */
export const SHAKEN_FIRE = 0.9;
export const WAVERING_FIRE = 0.75;

/** The share of its fire a stack gets away at this morale, by the rung it is on. */
export function moraleFireShare(morale: number): number {
  const state = moraleState(morale);
  if (state === 'steady') return 1;
  if (state === 'shaken') return SHAKEN_FIRE;
  return WAVERING_FIRE;
}

export function moraleState(morale: number): MoraleState {
  if (morale >= MORALE_THRESHOLDS.steady) return 'steady';
  if (morale >= MORALE_THRESHOLDS.shaken) return 'shaken';
  if (morale >= MORALE_THRESHOLDS.wavering) return 'wavering';
  return 'routed';
}

export const MORALE_STATE_LABELS: Record<MoraleState, string> = {
  steady: 'steady',
  shaken: 'shaken',
  wavering: 'wavering',
  routed: 'broken',
};

/**
 * Morale points lost for losing a stack's whole strength in one round. Scaled by what was lost.
 *
 * Thirty-five, from fourteen, on 2026-09-21. At fourteen the casualty term was under half a point
 * a round in an even fight (per-round losses run about 7% and `WINNING_RELIEF` nets that to
 * 0.03), while intimidation pressure was worth several, so the morale phase was a pressure clock
 * and casualties barely reached it. See `docs/BATTLE-ENGINE.md`, "The eight ratings".
 */
export const CASUALTY_SHOCK = 35;

/**
 * How much of the enemy's casualties count *against* your own when a stack judges how it is doing.
 *
 * Losing a tenth of your strength while the other side loses a fifth is not a shock. It is a
 * victory, and a model where it costs morale anyway makes every even fight end in mutual collapse.
 * That is not a hypothetical: without this term a 20-v-20 mirror broke *both* sides in round three
 * and handed the ground to whoever crossed the threshold second.
 *
 * It is also what makes a rout look like a rout. The side that is winning takes almost nothing,
 * the side that is losing takes all of it, and the gap compounds.
 */
export const WINNING_RELIEF = 0.6;

/**
 * How much harder every shock lands on a stack that is already low.
 *
 * Two, from 1.1, on 2026-09-21: the eight-ratings ladder puts morale a tenth over the average
 * rating, and fragility is most of what a morale point buys once pressure is no longer the whole
 * morale phase. See `docs/BATTLE-ENGINE.md`, "The eight ratings".
 */
export const FRAGILITY_WEIGHT = 2;

/**
 * Morale points a full intimidation edge is worth per round.
 *
 * Six, from fourteen, on 2026-09-21. This term is taken off every stack every round, scaled by
 * fragility, and subtracted from the quiet-round recovery too, and at fourteen it was the
 * strongest number in the engine by a wide margin: +25 intimidation on a defender cost an attacker
 * about four times the army that +25 armour did. The eight-ratings ladder puts intimidation a
 * fifth over the average rating, level with evasion, and six is where the harness lands it.
 * `CASUALTY_SHOCK` went up in the same pass so that casualties, not pressure, are what a line
 * mostly breaks from. See `docs/BATTLE-ENGINE.md`, "The eight ratings".
 */
export const INTIMIDATION_PRESSURE = 6;

/** Morale points lost per round for being outnumbered, at the worst. */
export const OUTNUMBERED_SHOCK = 5;

/**
 * Morale points a stack loses when the line beside it breaks, at the worst.
 *
 * Charged in proportion to how much of the side ran: see `MoraleShock.alliesBroken`. The whole
 * line going at once costs this; a tenth of it going costs a tenth of this. It was charged per
 * *stack* until 2026-09-21, which is the same thing only when every stack is the same size.
 */
export const ROUT_CASCADE = 10;

/** Morale points a stack recovers per round when nothing bad happened to it. */
export const MORALE_RECOVERY = 4;

/**
 * The multiplier every morale hit is scaled by, given where the stack already is.
 *
 * 1.0 at full morale, {@link FRAGILITY_WEIGHT} + 1 at zero. Linear rather than a curve because a
 * curve would be a second thing to balance and this axis already has four inputs feeding it.
 */
export function fragility(morale: number): number {
  return 1 + FRAGILITY_WEIGHT * (1 - Math.max(0, Math.min(100, morale)) / 100);
}

export interface MoraleShock {
  /** Fraction of the stack lost this round, 0..1. */
  casualtyFraction: number;
  /** ...and what the other side lost, which is how a stack knows it is winning. */
  enemyCasualtyFraction: number;
  /** The enemy's average intimidation, 0..100. */
  enemyIntimidation: number;
  /** Enemy units ÷ own units. Below 1 is an advantage and costs nothing. */
  outnumberedRatio: number;
  /**
   * The share of the side's standing bodies that broke last round, 0..1.
   *
   * A *share*, not a count of stacks, since 2026-09-21. As a count it was the same 10 points
   * whether one stack of two men ran or half the army did, and that made a force strictly worse
   * for having a small fragile stack in it: 62 Razors beat a Combine line 45% of the time, and
   * the same 62 with three Sparks bolted on won 0 of 600, because the Sparks broke first and
   * charged everyone else the full cascade. Sixty-two with twenty Sparks won 86%, so the hole
   * was not a slope but a pit. Eleven roster sheets sit under the 60-point `steady` line, so
   * this was reachable with most of the cheap units in the game.
   */
  alliesBroken: number;
  /** Holding fortified ground steadies a unit: percentage points of resistance to all of it. */
  resolvePercent: number;
}

/**
 * One round's worth of morale change, before it is applied.
 *
 * Every term is scaled by {@link fragility}, which is what makes the same shock worse on a unit
 * that is already coming apart. Recovery is *not* scaled: a stack that had a quiet round steadies
 * at the same rate whatever state it is in, so a fight can swing back and a player who breaks off
 * an assault has something to bring home.
 */
export function moraleDelta(shock: MoraleShock, morale: number): number {
  const resolve = Math.max(0, 1 - shock.resolvePercent / 100);
  const scale = fragility(morale) * resolve;

  const net = shock.casualtyFraction - WINNING_RELIEF * Math.max(0, shock.enemyCasualtyFraction);
  const casualties = CASUALTY_SHOCK * Math.max(0, Math.min(1, net));
  const pressure = INTIMIDATION_PRESSURE * (Math.max(0, shock.enemyIntimidation) / 100);
  const outnumbered =
    OUTNUMBERED_SHOCK * Math.max(0, Math.min(1, (shock.outnumberedRatio - 1) / 2));
  const cascade = ROUT_CASCADE * Math.max(0, Math.min(1, shock.alliesBroken));

  const damage = (casualties + pressure + outnumbered + cascade) * scale;

  /*
   * Whether the round was quiet is about what *happened*, not about how frightening the enemy is.
   *
   * This read `damage > 0 ? -damage : MORALE_RECOVERY`, which sounds like "a quiet round steadies
   * you" and was not: `pressure` is the enemy's average intimidation and it is ambient, present on
   * every round of every fight, so `damage` was above zero whenever the other side had any
   * intimidation at all. Measured across the whole 0..100 morale range: against an enemy at
   * intimidation 0 every morale level recovered, and against an enemy at 10, 30 or 60 none of them
   * did, at any level. One unit in the roster sits at zero intimidation, so `MORALE_RECOVERY` was a
   * constant the game could not reach and the doc above described a mechanic that did not exist.
   *
   * A quiet round is one where this stack lost nothing it did not give back and nobody beside it
   * broke. That is reachable and it is the mechanic that was wanted: `casualties` is already zero
   * whenever {@link WINNING_RELIEF} covers what was lost, so the stack that is *winning* is the one
   * that steadies. The enemy is still frightening while it does, which is why the ambient pressure
   * is still subtracted from what it recovers rather than ignored.
   */
  const quiet = casualties <= 0 && cascade <= 0 && outnumbered <= 0;
  return quiet ? MORALE_RECOVERY - pressure * scale : -damage;
}

/**
 * How much of a routed stack the enemy runs down before it gets clear.
 *
 * A rout is not a free withdrawal: Bannerlord deletes the stack outright, which is too blunt for
 * a game where the survivors matter, so this takes a share instead and leaves the rest to the
 * flee-or-die roll at the end of the fight.
 */
export const PURSUIT_LOSS = 0.2;
