import { buildingEffectiveness } from './damage.js';
import { districtEffects, MAX_EFFECT_REDUCTION } from './effects.js';
import { buildingLevel, findBuilding, type Building } from './state.js';

/**
 * What the district is worth to the crew standing in it (§A1).
 *
 * Five structures reach the crew through this module: the Quarters sets how many names the payroll
 * book can carry, the Gate holds the district and hides it, the Lab shortens research, the
 * Gauntlet trains everybody faster, and the Greenhouse takes supplies off a training bill. Each is
 * one exported function, so "what does the Gate actually do" has exactly one answer.
 *
 * The Quarters is the one exception, because it also houses people, and that is `population.ts`.
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

/** Percentage points the district adds to every allegiance XP award (§I1). */
export function factionXpBonus(buildings: readonly Building[]): number {
  return districtEffects(buildings).faction_xp_percent;
}

// --- the Gate (§A1: protection from raids) ---

export const DEFENSE_PER_GATE_LEVEL = 6;

/**
 * §B7: percentage points of defence on **every unit holding this district**, per Gate level.
 *
 * The board asked for the Gate's contribution to be an explicit, level-scaled percentage rather
 * than a number folded into a difficulty rating nobody could point at. This is that percentage, and
 * it lands on the same `defensePercent` channel the ground and the crew already push, so the
 * battle engine reads it without a new parameter: see `battle/effects.ts`, where a defending side
 * adds `territory.defensePercent` to what it is holding.
 *
 * The same figure applies wherever this crew is the defender, which is the other half of §B7: a
 * Gate raised on ground the crew has closed off pays there too, because the fold is per **crew**
 * rather than per plot of land.
 */
export const GATE_DEFENSE_PERCENT_PER_LEVEL = 2.5;

/**
 * §B7: percentage points of intel resistance, per Gate level.
 *
 * A wall is not only something to shoot from. What a scout brings back about a district is decided
 * by `intelResistancePercent` (`battle/intel.ts`), and a district nobody can walk up to is a
 * district nobody can count. Slower than the defence figure on purpose: a maxed Gate is 30 points
 * of resistance, which coarsens a scout's report without ever blanking it.
 */
export const GATE_INTEL_RESISTANCE_PER_LEVEL = 1.5;

/** The Gate's own working level: what is standing, less whatever a siege took out of it. */
function workingGateLevel(buildings: readonly Building[]): number {
  // A Gate that has been kicked in is worth less until it is rebuilt, which is most of what a
  // breach is *for*, and the reason a second raid inside the window is easier than the first.
  return buildingLevel(buildings, 'gate') * buildingEffectiveness(findBuilding(buildings, 'gate'));
}

/** §B7: what the Gate adds to every defender's `defensePercent`, modifications included. */
export function gateDefensePercent(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return workingGateLevel(buildings) * GATE_DEFENSE_PERCENT_PER_LEVEL + effects.defense_percent;
}

/** §B7: what the Gate adds to `intelResistancePercent`. */
export function gateIntelResistancePercent(buildings: readonly Building[]): number {
  return workingGateLevel(buildings) * GATE_INTEL_RESISTANCE_PER_LEVEL;
}

/**
 * What a raider has to beat before they touch anything behind it.
 *
 * The flat rating, kept alongside the percentage above because they answer different questions: a
 * player looking at the Gate's dialog wants one number for "how hard is this to get through", and
 * the engine wants a percentage it can put on a unit. Both scale with the same level and the same
 * damage, so they cannot disagree about whether the Gate is standing.
 */
export function districtDefense(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const gate = workingGateLevel(buildings) * DEFENSE_PER_GATE_LEVEL;
  return Math.round(gate * (1 + effects.defense_percent / 100));
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
export const CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL = 4;

export function infirmaryRecoveryPercent(buildings: readonly Building[]): number {
  return buildingLevel(buildings, 'infirmary') * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL;
}

/** Percentage points on what a won raid brings home. Modifications only: no structure grants it. */
export function raidLootBonus(buildings: readonly Building[]): number {
  return districtEffects(buildings).raid_loot_percent;
}

// --- the Gauntlet (§B6) and the Greenhouse (§B5): what training costs and how long it takes ---

/** Percentage points off every unit's training clock, per Gauntlet level. */
export const TRAINING_TIME_PER_GAUNTLET_LEVEL = 2;
/** And the ceiling on it, before modifications. A maxed Gauntlet is 40 points on its own. */
export const MAX_GAUNTLET_TRAINING_BONUS = 40;

/**
 * §B6: how much faster this district trains, in percentage points.
 *
 * Applies to **every** unit on the roster, including the ones the Gauntlet cannot train itself.
 * That is the board's wording and it is the right rule: the Gauntlet is where a crew learns to
 * drill, and a Cyber Dog assembled in the Infirmary is still handled by people who trained here.
 *
 * The Gauntlet's own contribution is capped separately from the modifications on top, so a maxed
 * Gauntlet is 40 points and a maxed Gauntlet carrying Salvaged Simulators is 52.
 */
export function trainingTimeReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const gauntlet = Math.min(
    MAX_GAUNTLET_TRAINING_BONUS,
    buildingLevel(buildings, 'gauntlet') * TRAINING_TIME_PER_GAUNTLET_LEVEL,
  );
  return gauntlet + effects.training_time_reduction;
}

/** Percentage points off the **supplies** line of a training bill, per Greenhouse level. */
export const TRAINING_SUPPLIES_PER_GREENHOUSE_LEVEL = 2;
/** And the ceiling on it, before modifications. */
export const MAX_GREENHOUSE_SUPPLIES_DISCOUNT = 30;

/**
 * §B5: how much less supplies a unit costs to train here, in percentage points.
 *
 * Supplies only, and that restriction is the whole point of the channel existing: the Greenhouse
 * grows food, so what it makes cheaper is the food a recruit eats while they learn, not the scrap
 * their armour is cut from. Folded on top of whatever general training discount the crew and the
 * ground already carry, in `trainingCost`, which applies the two to different lines of the bill.
 */
export function trainingSuppliesReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const greenhouse = Math.min(
    MAX_GREENHOUSE_SUPPLIES_DISCOUNT,
    buildingLevel(buildings, 'greenhouse') * TRAINING_SUPPLIES_PER_GREENHOUSE_LEVEL,
  );
  return greenhouse + effects.training_supplies_reduction;
}
