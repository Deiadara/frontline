import { UNIT_MODIFIERS, type UnitModifierId } from '../units/index.js';
import type { Effective } from './effects.js';

/**
 * What happens when one stack shoots at another: the interaction layer.
 *
 * Everything that makes this game's fights more than a subtraction lives here, and it is built out
 * of four independent multipliers rather than a hand-written counter table. A table of "X beats Y"
 * has to be rewritten every time a unit is added; four rules that read the *sheet* keep working,
 * and a designer who gives a new unit high speed and low armour already knows how it will play.
 *
 * The four:
 *
 * 1. **Damage type against resistance** (Wesnoth). A resistance is a percentage off, and a
 *    *negative* resistance is a vulnerability, which is how a unit ends up nearly immune to one
 *    thing and made of paper against another.
 * 2. **Armour** (0 A.D.). Exponential, not subtractive: each point multiplies incoming damage by
 *    {@link ARMOR_FALLOFF}, so armour never reaches zero damage and the tenth point is worth less
 *    than the first. Subtractive armour is what makes a heavy unit unkillable by anything cheap.
 * 3. **Engagement**: reach and closing. This is the range/speed half of the design, and the two
 *    terms are deliberately asymmetric; see {@link engagementEdge}.
 * 4. **Situational modifiers that depend on the target**: `vs_armor` and `vs_low_morale`. The
 *    other contexts are properties of the ground and were resolved once in `effects.ts`.
 */

/**
 * Each point of armour multiplies incoming damage by this.
 *
 * 0 A.D.'s idea, but **not** 0 A.D.'s number. Its armour values run 0-10 and ours run 0-100, and
 * carrying its per-point falloff across meant the Colossus took 1.6% of incoming damage and the
 * heavy tier could not be hurt by anything at all. Calibrated for this scale instead: armour 5
 * takes 94%, armour 45 takes 55%, and the heaviest sheet in the game at 95 still takes 28%.
 */
export const ARMOR_FALLOFF = 0.9868;

/** A resistance may not make a unit immune. 85% is "almost", which is the design brief. */
export const MAX_RESISTANCE = 85;

/** ...and a vulnerability may not double damage outright. */
export const MIN_RESISTANCE = -60;

/** How much a full reach advantage is worth: the volley you land before they arrive. */
export const REACH_WEIGHT = 0.45;

/** ...and a full closing advantage, against something that wanted to stay at range. */
export const CLOSING_WEIGHT = 0.6;

/**
 * Points of armour one point of penetration cancels.
 *
 * One for one, and deliberately so: `penetration 30` against `armour 30` means the plate does
 * nothing at all, which is a sentence a player can hold in their head. Because armour is
 * exponential (see the module note), cancelling the first points is worth far more than cancelling
 * the last, so a modest penetration against a heavy target is already a real answer without the
 * stat needing a curve of its own.
 */
export const PENETRATION_PER_ARMOR = 1;

/** Below this morale a target counts as shaken, and `vs_low_morale` sheets switch on. */
export const SHAKEN_MORALE = 40;

/** At or above this armour a target counts as armoured, and `vs_armor` sheets switch on. */
export const ARMORED_THRESHOLD = 25;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The multiplier a damage type gets against a defender's resistances.
 *
 * Returns more than 1 when the defender is *vulnerable*. That asymmetry is the point: a sheet with
 * `{ energy: 70, chemical: -40 }` describes a thing you beat by bringing the right people, which
 * is a decision, where flat damage reduction only describes a thing you beat by bringing more.
 */
export function damageTypeMultiplier(attacker: Effective, defender: Effective): number {
  const raw = defender.resistances[attacker.damageType] ?? 0;
  return 1 - clamp(raw, MIN_RESISTANCE, MAX_RESISTANCE) / 100;
}

/**
 * Exponential armour, less whatever the attacker's penetration cancels.
 *
 * See the module note on why the armour curve itself is not a subtraction. Penetration *is* a
 * subtraction, and against an exponential curve that is the strong version: taking 30 points off
 * a 30-armour target removes the whole multiplier, while taking 30 off a 90-armour target still
 * leaves it well protected. That is what "good against armour" should mean, and it is why a
 * specialist with penetration beats a heavy without needing a written counter rule.
 *
 * This replaced a critical-hit chance, which is what the stat used to be. A crit is a bonus
 * against *everything*, so it said nothing about who a unit is for; penetration is worth exactly
 * as much as the target is armoured, which is a choice about what you send.
 */
export function armorMultiplier(armor: number, penetration = 0): number {
  const defeated = Math.max(0, penetration) * PENETRATION_PER_ARMOR;
  return ARMOR_FALLOFF ** Math.max(0, armor - defeated);
}

/**
 * Reach and closing, the two halves of the range/speed interaction.
 *
 * **Reach** is `range − their speed`: the fire you land before they reach you. It is worth the most
 * against something slow, and nothing at all against something that crosses the ground faster than
 * you can range it. That is "range works against slow units".
 *
 * **Closing** is `speed − their speed`, weighted by *how much they were relying on range*. A fast
 * unit gets nothing extra for catching another fast unit, and nothing for catching a wall of
 * shields, but catching something that wanted to be far away and was built for it is the whole
 * play. That is "fast units kill snipers easier", and it is why closing reads the target's `range`
 * rather than its own: a Sniper is fragile *because it is a Sniper*, and the sheet already says so.
 *
 * They are asymmetric on purpose. Two symmetric terms would cancel in every matchup and the whole
 * axis would collapse into a wash.
 */
export function engagementEdge(
  attacker: Effective,
  defender: Effective,
): { reach: number; closing: number } {
  return {
    reach: clamp(attacker.range - defender.speed, 0, 100) / 100,
    closing: (clamp(attacker.speed - defender.speed, 0, 100) / 100) * (defender.range / 100),
  };
}

export function engagementMultiplier(attacker: Effective, defender: Effective): number {
  const { reach, closing } = engagementEdge(attacker, defender);
  return 1 + REACH_WEIGHT * reach + CLOSING_WEIGHT * closing;
}

/**
 * The percentage a unit's target-dependent modifiers are worth against *this* defender.
 *
 * `vs_low_morale` is the mechanical half of intimidation: a Terror unit is worth nothing against a
 * steady enemy and a third again as much against one already coming apart. Morale is therefore
 * read live, per round, rather than frozen with the rest of the sheet.
 */
export function targetBonusPercent(
  modifiers: readonly UnitModifierId[],
  defender: Effective,
  defenderMorale: number,
): number {
  let percent = 0;
  for (const id of modifiers) {
    const modifier = UNIT_MODIFIERS[id];
    if (modifier.context === 'vs_armor' && defender.armor >= ARMORED_THRESHOLD) {
      percent += modifier.percent;
    }
    if (modifier.context === 'vs_low_morale' && defenderMorale < SHAKEN_MORALE) {
      percent += modifier.percent;
    }
  }
  return percent;
}

export interface Exchange {
  /** Damage one attacking body deals to one defending body, before stack sizes. */
  perBody: number;
  /** The individual multipliers, kept for the report and for tests that pin one of them. */
  parts: {
    type: number;
    armor: number;
    engagement: number;
    dodge: number;
    target: number;
  };
}

/**
 * What one attacker does to one defender.
 *
 * Reductions multiply (`dodge`, `armor`, an unfavourable `type`) and bonuses were already summed
 * into `offense` and `target`. See `effects.ts` for why that split is load-bearing.
 *
 * Dodging is a **chance to miss** rather than a damage discount, and it reads the defender's sheet
 * alone: see {@link missChance}.
 */

/**
 * Points of evasion per point of miss chance.
 *
 * Evasion halved is the chance a hit does not land: 60 evasion means three shots in ten go past.
 * Two, because evasion is a 0..100 rating and a rating that *was* the miss chance would put the
 * top of the scale at "never hit", which is not a unit, it is a wall. Halved, the most evasive
 * sheet in the game still takes better than half of what is aimed at it.
 *
 * At stack scale this is applied as its expectation rather than rolled per shot, and that is the
 * accurate version rather than a shortcut: a round is hundreds of bodies firing, `fireRound`
 * settles the whole stack's output in one number, and the mean of hundreds of independent rolls is
 * the miss rate to four figures. The variance a player actually feels is already in the fight, and
 * it is seeded: `ROUND_LUCK` and `BATTLE_LUCK` are the dice, and they are drawn where a replay can
 * reproduce them.
 *
 * It used to be a straight damage multiplier that speed could erode, on the theory that evasion is
 * what you do when you see it coming. That coupled two axes for no gain a player could read: the
 * sheet said 60 and what it was worth depended on who was shooting.
 */
export const EVASION_PER_MISS = 2;

/** The chance one attack does not land, 0..1, from the defender's evasion alone. */
export function missChance(evasion: number): number {
  return clamp(evasion, 0, 100) / (EVASION_PER_MISS * 100);
}

export function exchange(
  attacker: Effective,
  attackerModifiers: readonly UnitModifierId[],
  defender: Effective,
  defenderMorale: number,
  /** The attacker's luck on the day, in points of penetration. See `luck.ts`. */
  luck = 0,
): Exchange {
  const type = damageTypeMultiplier(attacker, defender);
  // Luck rides on penetration now that penetration is what the stat is: added in points rather
  // than multiplied in, so a unit with little of it gains a lot from a good day and a specialist
  // barely notices, which is the right way round.
  const armor = armorMultiplier(defender.armor, attacker.penetration + luck);
  const engagement = engagementMultiplier(attacker, defender);

  const dodge = 1 - missChance(defender.evasion);
  const target = 1 + targetBonusPercent(attackerModifiers, defender, defenderMorale) / 100;

  return {
    perBody: attacker.offense * type * armor * engagement * dodge * target,
    parts: { type, armor, engagement, dodge, target },
  };
}

/**
 * How attractive a target is to this attacker: what drives who shoots at whom.
 *
 * This is the whole counter system, and it is one number. Rather than an authored "X counters Y"
 * table, every stack picks its target by *expected damage per body of enemy health*, so an
 * armour-piercing unit walks toward the heavies, a fast unit runs down the shooters and a Terror
 * unit finishes whatever is already breaking: all without any of those three being written down
 * anywhere as a rule. A new unit with a new sheet slots into the same arithmetic.
 *
 * Divided by vitality so that "efficient to kill" beats "big": focusing a Colossus with rifles
 * because it is the largest number on the field is exactly the behaviour this avoids.
 */
export function threatWeight(
  attacker: Effective,
  attackerModifiers: readonly UnitModifierId[],
  defender: Effective,
  defenderMorale: number,
): number {
  // Deliberately luck-free. Targeting is a decision the crew makes about the enemy in front of
  // them; folding the day's luck into it would make a lucky side pick *different targets*, which is
  // not what luck means and would make the counter system jitter for no reason.
  const { perBody } = exchange(attacker, attackerModifiers, defender, defenderMorale);
  return perBody / Math.max(1, defender.vitality);
}
