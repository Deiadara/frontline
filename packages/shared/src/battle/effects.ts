import type { TerritoryEffects } from '../city/index.js';
import {
  UNIT_MODIFIERS,
  type CombatContext,
  type UnitSpec,
  type UnitStats,
} from '../units/index.js';
import type { Battlefield } from './battlefield.js';

/**
 * From a unit's sheet to the numbers it fights with.
 *
 * One rule governs the whole pipeline, and it is Heroes III's: **bonuses add, reductions
 * multiply.** Three +25% modifiers make +75%, not ×1.95 — so stacking stays legible and a player
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
  /** Holding the place, rather than coming for it. */
  defending: boolean;
  /** Fewer bodies than the other side, by {@link OUTNUMBERED_RATIO} or worse. */
  outnumbered: boolean;
}

/** Facing this many times your own number is what a sheet means by "when outnumbered". */
export const OUTNUMBERED_RATIO = 1.5;

/**
 * The most that holding ground can be worth, in percentage points of toughness.
 *
 * Fortification and a Gate stack, and both scale with investment, so without a ceiling a maxed
 * defender reaches a point where no force can be assembled to take them. Every defence in this game
 * has to be beatable by bringing enough.
 */
export const MAX_HELD_DEFENSE = 65;

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
  lethality: number;
  /** Only read on the way out: how well a broken stack gets clear (`rout.ts`). */
  stealth: number;
  intimidation: number;
  /** Starting morale, 0..100. Falls during the fight; this is where it begins. */
  morale: number;
  damageType: UnitStats['damageType'];
  resistances: UnitStats['resistances'];
  /** Named reasons this unit is above or below its sheet, for the report. */
  reasons: readonly string[];
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The percentage a unit's own modifiers are worth here.
 *
 * Summed, not multiplied — see the module note. Contexts that do not hold contribute nothing at
 * all rather than a fraction: a sheet that says "in built-up ground" is a promise about built-up
 * ground, and partial credit for fighting *near* some would make it unreadable.
 */
export function contextBonusPercent(
  unit: UnitSpec,
  contexts: readonly CombatContext[],
): { percent: number; reasons: string[] } {
  let percent = 0;
  const reasons: string[] = [];
  for (const id of unit.modifiers) {
    const modifier = UNIT_MODIFIERS[id];
    if (!contexts.includes(modifier.context)) continue;
    percent += modifier.percent;
    reasons.push(modifier.label);
  }
  return { percent, reasons };
}

/**
 * Everything that is true about a unit before the enemy is considered.
 *
 * `vs_armor`, `vs_low_morale` and `vs_structure` are **not** resolved here even though they are
 * `CombatContext`s: the first two depend on who the unit is shooting at, so they belong to the
 * matchup and are applied per exchange (`matchup.ts`). `vs_structure` does live here, because the
 * fortification is a property of the ground and does not change with the target.
 */
export function effectiveStats(
  unit: UnitSpec,
  battlefield: Battlefield,
  side: SideContext,
  territory: TerritoryEffects,
): Effective {
  const contexts: CombatContext[] = [...battlefield.contexts];
  if (side.defending) contexts.push('defending');
  if (side.outnumbered) contexts.push('outnumbered');

  const { percent, reasons } = contextBonusPercent(unit, contexts);
  const offenseBonus = percent + territory.unitOffensePercent;
  const sheet = unit.stats;

  // Everything the holder built buys *toughness*, not damage: a wall does not make a rifle shoot
  // harder. This is the one place percentages land on vitality rather than on offense.
  //
  // `defensePercent` is what the Gate is for (§A1). It was computed by `districtDefense` and read
  // by nothing at all — the structure whose entire job is raid protection did not appear anywhere
  // in a fight. Capped, because a Gate at 20 produces 120 and a defender at +120% toughness on top
  // of fortification is a district nobody can raid.
  const held = side.defending ? battlefield.fortifyPercent + territory.defensePercent : 0;
  const vitalityBonus = territory.unitVitalityPercent + Math.min(MAX_HELD_DEFENSE, held);

  return {
    offense: sheet.offense * (1 + offenseBonus / 100),
    vitality: sheet.vitality * (1 + vitalityBonus / 100),
    armor: clamp(sheet.armor + (side.defending ? battlefield.baseDefense : 0), 0, 100),
    speed: sheet.speed * (1 + territory.unitSpeedPercent / 100),
    range: sheet.range,
    evasion: sheet.evasion,
    lethality: sheet.lethality,
    stealth: sheet.stealth,
    intimidation: sheet.intimidation,
    morale: clamp(sheet.morale + territory.unitMoraleFlat, 0, 100),
    damageType: sheet.damageType,
    resistances: sheet.resistances,
    reasons: held > 0 ? [...reasons, 'Holding built ground'] : reasons,
  };
}
