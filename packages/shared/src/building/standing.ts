import { buildingEffectiveness, gateFortifyPercent } from './damage.js';
import { districtEffects, MAX_EFFECT_REDUCTION } from './effects.js';
import { buildingLevel, findBuilding, type Building } from './state.js';

/**
 * What the district is worth to the crew standing in it (§A1).
 *
 * Four structures reach the crew through this module: the Quarters sets how many names the payroll
 * book can carry, the Gate sets what a raider has to beat, the Lab shortens research, and the
 * Gauntlet pays officers more for the same work. Three of them do their *whole* job here: the
 * Quarters is the exception, because it also houses people, and that is `population.ts`. Everything
 * else is one exported function, so "what does the Gate actually do" has exactly one answer.
 */

// --- the payroll book (§H7): how many names the district can carry ---

/**
 * Percentage points the district adds to the payroll ceiling.
 *
 * The Quarters is what this hangs off, and the reasoning is the same one that used to hang morale
 * there: an officer's fee is mostly what it costs them to live where you have put them, so a
 * district with beds, water and clean air is a district that can carry more names on the same
 * caps. `payroll_percent` modifications add to it.
 *
 * A percentage rather than a flat figure, because the base ceiling grows with the Nexus and a flat
 * bonus would be the whole book early and a rounding error later.
 */
export const PAYROLL_PERCENT_PER_QUARTERS_LEVEL = 2;

export function payrollBonusPercent(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return (
    buildingLevel(buildings, 'quarters') * PAYROLL_PERCENT_PER_QUARTERS_LEVEL +
    effects.payroll_percent
  );
}

/** Percentage points the district adds to every faction XP award (§I1). */
export function factionXpBonus(buildings: readonly Building[]): number {
  return districtEffects(buildings).faction_xp_percent;
}

// --- the Gate (§A1: protection from raids) ---

export const DEFENSE_PER_GATE_LEVEL = 6;

/**
 * What a raider has to beat before they touch anything behind it.
 *
 * Added to the target's own difficulty by the battle engine, so a well-gated district is harder to
 * take than a bare one on the same ground. It is read for *whichever side is defending*, which is
 * why the bot rival's Gate already makes a difference today, and why a player's own Gate starts
 * paying the moment crews can raid each other.
 */
export function districtDefense(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  // A Gate that has been kicked in is worth less until it is rebuilt, which is most of what a
  // breach is *for*, and the reason a second raid inside the window is easier than the first.
  const gate =
    buildingLevel(buildings, 'gate') *
    DEFENSE_PER_GATE_LEVEL *
    buildingEffectiveness(findBuilding(buildings, 'gate'));
  // §A4: and how far the Gate itself has been dug in, which is materials rather than bodies.
  return Math.round(gate * (1 + effects.defense_percent / 100) + gateFortifyPercent(buildings));
}

// --- the Lab, the Gauntlet, the Infirmary and the haul ---

/** Percentage points the Lab takes off every research project's clock, per level. */
export const RESEARCH_TIME_PER_LAB_LEVEL = 2;

export function researchTimeReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return Math.min(
    MAX_EFFECT_REDUCTION,
    buildingLevel(buildings, 'lab') * RESEARCH_TIME_PER_LAB_LEVEL + effects.research_time_reduction,
  );
}

/** Percentage points the Gauntlet adds to every character XP award, per level (§H6). */
export const CHARACTER_XP_PER_GAUNTLET_LEVEL = 2;

export function characterXpBonus(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return (
    buildingLevel(buildings, 'gauntlet') * CHARACTER_XP_PER_GAUNTLET_LEVEL +
    effects.character_xp_percent
  );
}

/**
 * §A1: the share of a winning force's casualties the Infirmary gets back on their feet.
 *
 * The structure's whole job now that morale is gone. It used to soften a missed payday, which was
 * a meter nobody could see; this is the same idea pointed at the thing a player actually loses
 * when a fight goes badly. Folded in beside the crew's own medics (`casualtyRecoveryPercent`),
 * which is why it is a percentage rather than a count.
 */
export const CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL = 1.5;

export function infirmaryRecoveryPercent(buildings: readonly Building[]): number {
  return buildingLevel(buildings, 'infirmary') * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL;
}

/** Percentage points on what a won raid brings home. Modifications only: no structure grants it. */
export function raidLootBonus(buildings: readonly Building[]): number {
  return districtEffects(buildings).raid_loot_percent;
}
