import { labelVerdict, type TerritoryEffects } from '../city/index.js';
import {
  UNIT_MODIFIERS,
  capRating,
  upgradedStats,
  type CombatContext,
  type FittedUpgrades,
  type UnitModifierSpec,
  type UnitSpec,
  type UnitStats,
} from '../units/index.js';
import { effectiveSpeed } from '../time/speed.js';
import { softCap } from './soft-cap.js';
import type { Battlefield } from './battlefield.js';
import type { UnitTierStat } from '../units/tiers.js';

/**
 * From a unit's sheet to the numbers it fights with.
 *
 * One rule governs the whole pipeline, and it is Heroes III's: **bonuses add, reductions
 * multiply.** Three +25% modifiers make +75%, not ×1.95, so stacking stays legible and a player
 * can do the arithmetic in their head. Reductions compose the other way, `×(1−a)×(1−b)`, so no
 * amount of armour and resistance ever reaches zero damage. Getting those two backwards is how a
 * combat system ends up with an unkillable stack, and it is the single most common way this class
 * of engine breaks.
 *
 * Nothing here is random and nothing here reads the other side. This is the unit *as it stands on
 * this ground*, computed once at the start of the fight and then held: a modifier that switched on
 * and off between rounds would make a report impossible to explain.
 */

/** The contexts that depend on the side rather than the ground. */
export interface SideContext {
  /** Holding the location, rather than coming for it. */
  defending: boolean;
  /**
   * How far "when outnumbered" holds, 0 to 1 (`outnumberedWeight`): nothing at even numbers, in
   * full at {@link OUTNUMBERED_FULL} to one or worse.
   */
  outnumbered: number;
}

/** Facing this many times your own unit slots is where "when outnumbered" holds in full. */
export const OUTNUMBERED_FULL = 2;

/**
 * How far a side facing `enemySlots` with `ownSlots` is outnumbered, 0 to 1.
 *
 * A straight ramp from even numbers to {@link OUTNUMBERED_FULL}, the way the outnumbered morale
 * shock already ramps (`morale.ts`). It was a step at 1.5 to 1 until 2026-10-02, and a step made
 * one more unit able to lose a fight: Wardens holding against 90 Razors won 55% with 29, 74% with
 * 30 and 39% with 31, because the 31st switched Last Stand off for the whole line (maintainer
 * ruling P10-A: more units must always be a bit better).
 */
export function outnumberedWeight(enemySlots: number, ownSlots: number): number {
  if (ownSlots <= 0 || enemySlots <= ownSlots) return 0;
  return Math.min(1, (enemySlots / ownSlots - 1) / (OUTNUMBERED_FULL - 1));
}

/**
 * What holding ground is worth, in percentage points of toughness: in full up to the knee, then
 * less for every point after, closing on the ceiling and never reaching it.
 *
 * A Gate and everything else that makes a holder hard to shift stack, and both scale with
 * investment, so without a curve a maxed defender reaches a point where no force can be assembled
 * to take them: every defence in this game has to be beatable by bringing enough. It was a hard
 * 65 until 2026-10-01, and a level 20 Gate filled 50 of that alone, so Strategy, the defence perks
 * and the Gate perks paid nothing to a well-built defender. The maintainer's ruling that day: a
 * curve, anchored so that ordinary figures barely move and every extra point still adds a little.
 * Measured on it: 50 is 50, the old ceiling of 65 is 63.5, 100 is 78.3, and nothing reaches 85.
 */
export const HELD_DEFENSE_KNEE = 55;
export const HELD_DEFENSE_CEILING = 85;

/** Held-ground toughness after the curve. See {@link HELD_DEFENSE_KNEE}. */
export function heldDefense(percent: number): number {
  return softCap(Math.max(0, percent), HELD_DEFENSE_KNEE, HELD_DEFENSE_CEILING);
}

/**
 * What one syringe is worth, in percentage points of offense.
 *
 * Small on purpose. A Black Clinic at level 4 hands out five of them, which is a real edge and not
 * a fight decided before it starts: the location is a thumb on the scale, not a second army.
 */
export const STIM_PERCENT_EACH = 3;

/**
 * The syringes a side has on hand (`battleStims`: the Black Clinic and the Stim Chemist
 * perk), handed out before the fight.
 *
 * On the offense and morale channels the engine already reads, so the report explains them the
 * way it explains a bought boost. Here rather than in the declared-battle settler, because a battle
 * job is a fight too: the settler was the only caller, and the two rungs paid nothing on a job.
 */
export function stimmed<
  T extends Pick<TerritoryEffects, 'battleStims' | 'unitOffensePercent' | 'unitMoraleFlat'>,
>(effects: T): T {
  const stims = Math.max(0, effects.battleStims);
  if (stims === 0) return effects;
  return {
    ...effects,
    unitOffensePercent: effects.unitOffensePercent + stims * STIM_PERCENT_EACH,
    unitMoraleFlat: effects.unitMoraleFlat + stims,
  };
}

/**
 * The live numbers a stack fights with. Deliberately a flat struct rather than a `UnitStats`:
 * these are *derived*, and handing back something that looks like a sheet invites code to write
 * one back to a unit.
 */
export interface Effective {
  offense: number;
  vitality: number;
  armor: number;
  speed: number;
  range: number;
  evasion: number;
  penetration: number;
  /** Only read on the way out: how well a broken stack gets clear (`rout.ts`). */
  stealth: number;
  intimidation: number;
  /** Starting morale, 0..100. Falls during the fight; this is where it begins. */
  morale: number;
  damageType: UnitStats['damageType'];
  resistances: UnitStats['resistances'];
  /** Named reasons this unit is above or below its sheet, for the report. */
  reasons: readonly string[];
  /**
   * How much a gate multiplied this unit's vitality, 1 when no gate is protecting it.
   *
   * Kept apart because one kind of attacker does not meet the gate at all: a Breaching unit's hits
   * land as if it were not there (`matchup.ts`), so the gate's share has to be separable from the
   * rest of what the holder built. Optional, so a sheet written by hand in a test is ungated.
   */
  gateToughness?: number;
}

/**
 * The percentage a unit's own modifiers are worth here.
 *
 * Summed, not multiplied: see the module note. Contexts that do not hold contribute nothing at
 * all rather than a fraction: a sheet that says "in urban ground" is a promise about urban
 * ground, and partial credit for fighting *near* some would make it unreadable. The one exception
 * is a context that holds by degree, which `weights` names: being outnumbered ramps from even odds
 * to two to one (`outnumberedWeight`), so Last Stand pays that share of itself.
 */
export function contextBonusPercent(
  unit: UnitSpec,
  contexts: readonly CombatContext[],
  /** How far a context holds where it holds by degree (`outnumbered`); 1 where left out. */
  weights: Partial<Record<CombatContext, number>> = {},
): { percent: number; toughness: number; reasons: string[] } {
  let percent = 0;
  let toughness = 0;
  const reasons: string[] = [];
  for (const id of unit.modifiers) {
    // Annotated, because the table is declared `as const`: without it every entry narrows to its
    // own literal shape and `affects` "does not exist" on the ones that leave it out.
    const modifier: UnitModifierSpec = UNIT_MODIFIERS[id];
    // Tracking and Breaching take something off the target rather than adding to this unit, and
    // are read per exchange in `matchup.ts`.
    if (modifier.affects === 'evasion' || modifier.affects === 'gate') continue;
    if (!contexts.includes(modifier.context)) continue;
    // `affects` is optional and defaults to damage: every modifier written before a defensive
    // sheet existed is an attack bonus and stays one.
    const worth = modifier.percent * (weights[modifier.context] ?? 1);
    if (modifier.affects === 'toughness') toughness += worth;
    else percent += worth;
    reasons.push(modifier.label);
  }
  return { percent, toughness, reasons };
}

/**
 * Everything that is true about a unit before the enemy is considered.
 *
 * `vs_armor`, `vs_evasive`, `vs_low_morale` and `vs_structure` are **not** resolved here even
 * though they are `CombatContext`s: the first three depend on who the unit is shooting at, so they
 * belong to the matchup and are applied per exchange (`matchup.ts`). `vs_structure` does live here,
 * because the fortification is a property of the ground and does not change with the target.
 *
 * `upgrades` is the workshop's refit (`units/upgrades.ts`), folded onto the sheet *first* so every
 * percentage below multiplies the upgraded figure rather than the catalogue one. It was the one
 * input the engine did not read: a crew could buy Slaved Optics for every unit it owns and fight
 * exactly as well as one that had not, which made the whole workshop a number on a screen.
 */
export function effectiveStats(
  unit: UnitSpec,
  battlefield: Battlefield,
  side: SideContext,
  /*
   * `TerritoryEffects` plus the one crew-only channel a unit's stats can read.
   *
   * Widened rather than moved. `unitKindPercent` is a §B7 perk channel and no piece of ground
   * grants it, so putting it on `TerritoryEffects` would be a lie about what the map can do; and
   * importing `CrewEffects` here would point the battle module at the crew module for one field.
   * Optional, because every caller in a fight passes a `CrewEffects`, which has it, and the unit
   * tests that pass a bare `TerritoryEffects` should not have to invent one.
   */
  territory: TerritoryEffects & {
    unitKindPercent?: Record<string, Partial<Record<UnitTierStat, number>>>;
    /**
     * §D5: flat points of evasion, from the officer leading (`crew/effects.ts`).
     *
     * Widened for the same reason `unitKindPercent` is: no piece of ground grants it, so putting
     * it on `TerritoryEffects` would be a lie about what the map can do, and the fights that pass
     * a bare `TerritoryEffects` should not have to invent a zero.
     */
    unitEvasionFlat?: number;
  },
  upgrades: FittedUpgrades = [],
): Effective {
  const contexts: CombatContext[] = [...battlefield.contexts];
  if (side.defending) contexts.push('defending');
  if (side.outnumbered > 0) contexts.push('outnumbered');

  const { percent, toughness, reasons } = contextBonusPercent(unit, contexts, {
    outnumbered: side.outnumbered,
  });
  const sheet = upgrades.length === 0 ? unit.stats : upgradedStats(unit.stats, upgrades);

  /*
   * What the ground and the sky are worth to *this* unit (`city/labels.ts`).
   *
   * Read off the **upgraded** sheet rather than the catalogue one, so a refit that adds armour
   * genuinely changes how a unit copes with the cold: the alternative is a workshop upgrade that
   * moves eleven numbers and is invisible to the one system built to read them.
   *
   * Summed with the context modifiers rather than multiplied against them, for the reason at the
   * top of this file: a player has to be able to add up why their Anodics are at +46% in a press
   * hall at four in the morning, and `1.25 × 1.26 × 1.04` is not something anybody adds up.
   */
  const ground = labelVerdict(sheet, unit, battlefield.labels);

  /*
   * What a bonus scoped to *this unit's tier* is worth (`unit_tier` in `city/locations.ts`).
   *
   * Read off `unit.tier` rather than the sheet, because a refit does not change what kind of thing
   * a unit is. Summed into the same totals as everything else, for the reason at the top of this
   * file: a player has to be able to add the reasons up.
   */
  const tier = territory.unitTierPercent[unit.tier] ?? {};
  /*
   * And what a bonus scoped to *this exact unit* is worth (`unit_kind` in `crew/perks.ts`).
   *
   * The narrowest bonus in the game, which is why it carries the biggest numbers: a tier bonus is
   * a reason to field a tier, and this is a reason to field one particular unit. Added to the tier
   * bonus rather than replacing it, so a crew that has both gets both, and summed with everything
   * else for the reason at the top of this file.
   */
  const kind = territory.unitKindPercent?.[unit.id] ?? {};
  const offenseBonus =
    percent +
    ground.percent +
    territory.unitOffensePercent +
    (tier.offense ?? 0) +
    (kind.offense ?? 0);

  // Everything the holder built buys *toughness*, not damage: a wall does not make a rifle shoot
  // harder. This is the one place percentages land on vitality rather than on offense.
  //
  // The gate (`gatePercent`) and everything else the holder has that makes them harder to shift
  // (`defensePercent`), curved together (`heldDefense`), because a Gate at 20 produces 120 and a defender at +120%
  // toughness on top of the rest is a district nobody can raid. Dug-in fortification was a third
  // term here until the maintainer took it out of the game (2026-09-26): a location is made
  // tougher by its gate and by bonuses, not by digging.
  const held = side.defending ? territory.defensePercent + territory.gatePercent : 0;
  const heldWithoutGate = side.defending ? territory.defensePercent : 0;
  // The unit's own toughness modifiers are added *outside* the held-ground curve on purpose. That
  // curve exists so no amount of building makes a district untakeable; a sheet that says it is
  // hard to shift is a unit you can be sent to kill, and it is bought one unit at a time.
  const ownToughness =
    territory.unitVitalityPercent + (tier.vitality ?? 0) + (kind.vitality ?? 0) + toughness;
  const vitalityBonus = ownToughness + heldDefense(held);
  const withoutGateBonus = ownToughness + heldDefense(heldWithoutGate);
  const withoutGate = 1 + withoutGateBonus / 100;

  return {
    offense: sheet.offense * (1 + offenseBonus / 100),
    vitality: sheet.vitality * (1 + vitalityBonus / 100),
    // What the gate multiplied that by, for the one kind of attacker that does not meet it.
    gateToughness: withoutGate > 0 ? (1 + vitalityBonus / 100) / withoutGate : 1,
    // Armour is points on a 0..100 rating, not a multiplier: see `unitArmorPercent`. Still capped,
    // so no stack of bonuses produces a unit nothing can hurt. Every rating below goes through
    // `capRating` rather than its own `Math.min`: the maintainer's rule (2026-09-15) is a hard 100
    // whatever adds to a rating, and one helper is the only way that stays one rule.
    armor: capRating(
      sheet.armor +
        (side.defending ? battlefield.baseDefense : 0) +
        territory.unitArmorPercent +
        (tier.armor ?? 0) +
        (kind.armor ?? 0),
    ),
    // Capped at 100 like every other speed in the game (`time/speed.ts`): the same number decides
    // this unit's road, and a unit cannot be quicker than the top of its own scale on one of them
    // and not the other. Deliberately unrounded, so the engagement terms keep their resolution.
    speed: effectiveSpeed(sheet.speed, { percent: territory.unitSpeedPercent }),
    range: sheet.range,
    // Points, not a multiplier, and clamped for the same reason armour is: no stack of bonuses may
    // produce a unit nothing can hit.
    evasion: capRating(sheet.evasion + (territory.unitEvasionFlat ?? 0)),
    penetration: sheet.penetration,
    stealth: capRating(Math.round(sheet.stealth * (1 + territory.unitStealthPercent / 100))),
    /*
     * §A4: the ground's own menace, which until now was accumulated and read by nobody.
     *
     * `intimidationFlat` has always been summed out of the hold bonuses and never reached an
     * engine, so the Broadcast Tower, whose *only* bonus is intimidation, was worth exactly nothing
     * to hold. It has a consumer now: `intimidate` in the engine spends a side's total intimidation
     * against the enemy's total morale before the first shot. Clamped like morale beside it, and
     * for the same reason: no stack of bonuses may put a unit past the sheet's own ceiling.
     */
    intimidation: capRating(sheet.intimidation + territory.intimidationFlat),
    morale: capRating(sheet.morale + territory.unitMoraleFlat),
    damageType: sheet.damageType,
    resistances: sheet.resistances,
    reasons: [...reasons, ...ground.reasons, ...(held > 0 ? ['Holding built ground'] : [])],
  };
}
