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

/** Morale points lost for losing a stack's whole strength in one round. Scaled by what was lost. */
export const CASUALTY_SHOCK = 14;

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

/** How much harder every shock lands on a stack that is already low. */
export const FRAGILITY_WEIGHT = 1.1;

/** Morale points a full intimidation edge is worth per round. */
export const INTIMIDATION_PRESSURE = 14;

/** Morale points lost per round for being outnumbered, at the worst. */
export const OUTNUMBERED_SHOCK = 5;

/** Morale points a stack loses when a neighbour breaks: the cascade. */
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
  /** Enemy bodies ÷ own bodies. Below 1 is an advantage and costs nothing. */
  outnumberedRatio: number;
  /** How many friendly stacks broke this round. */
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
  const cascade = ROUT_CASCADE * Math.max(0, shock.alliesBroken);

  const damage = (casualties + pressure + outnumbered + cascade) * scale;
  return damage > 0 ? -damage : MORALE_RECOVERY;
}

/**
 * How much of a routed stack the enemy runs down before it gets clear.
 *
 * A rout is not a free withdrawal: Bannerlord deletes the stack outright, which is too blunt for
 * a game where the survivors matter, so this takes a share instead and leaves the rest to the
 * flee-or-die roll at the end of the fight.
 */
export const PURSUIT_LOSS = 0.2;
