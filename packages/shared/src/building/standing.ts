import { softCap } from '../battle/soft-cap.js';
import { districtEffects } from './effects.js';
import { buildingLevel, type Building } from './state.js';

/**
 * What the district is worth to the crew standing in it (§A1).
 *
 * Five structures reach the crew through this module: the Quarters sets how many names the payroll
 * book can carry, the Gate holds the district and hides it, the Lab shortens research, the
 * Gauntlet musters everybody faster, and the Greenhouse takes supplies off a muster bill. Each is
 * one exported function, so "what does the Gate actually do" has exactly one answer.
 *
 * The Quarters is the one exception, because it also houses people, and that is `unit-slots.ts`.
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
 * The maintainer asked for the Gate's contribution to be an explicit, level-scaled percentage rather
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
 * A wall is not only something to shoot from. What a spy brings back about a district is decided
 * by `intelResistancePercent`, and a district nobody can walk up to is a district nobody can
 * count. Slower than the defence figure on purpose: a maxed Gate is 30 points of resistance, which
 * coarsens a spy report without ever blanking it.
 */
/**
 * What a level of Gate is worth against spies (2026-09-22): the same figure the spy contest
 * charges per level (`SPY_GATE_POINTS_PER_LEVEL`), so the board's "against spies" line and the
 * budget a job is priced against are one number. Pinned equal in `spying.test.ts`.
 */
export const GATE_INTEL_RESISTANCE_PER_LEVEL = 10;

/** §B7: what the Gate adds to every defender's `gatePercent`, modifications included. */
export function gateDefensePercent(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return (
    buildingLevel(buildings, 'gate') * GATE_DEFENSE_PERCENT_PER_LEVEL + effects.defense_percent
  );
}

/**
 * Points the district's counter-intelligence cards put in a spy's way (maintainer, 2026-10-01),
 * on top of the holder's Master of Whispers, the people's counter-intelligence and the gate. Read
 * by the spy contest only (`crewCounter`). Not cut by a breach: a broken door does not decrypt
 * anything.
 */
export function counterIntelPoints(buildings: readonly Building[]): number {
  return districtEffects(buildings).counter_intel_points;
}

/** §B7: what the Gate adds to `intelResistancePercent`. */
export function gateIntelResistancePercent(buildings: readonly Building[]): number {
  return buildingLevel(buildings, 'gate') * GATE_INTEL_RESISTANCE_PER_LEVEL;
}

/**
 * What a raider has to beat before they touch anything behind it.
 *
 * The flat rating, kept alongside the percentage above because they answer different questions: a
 * player looking at the Gate's dialog wants one number for "how hard is this to get through", and
 * the engine wants a percentage it can put on a unit. Both scale with the same level, so they
 * cannot disagree about what the Gate is worth.
 */
export function districtDefense(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const gate = buildingLevel(buildings, 'gate') * DEFENSE_PER_GATE_LEVEL;
  return Math.round(gate * (1 + effects.defense_percent / 100));
}

// --- the Lab, the Gauntlet, the Infirmary and the haul ---

/**
 * Percentage off every research price, per Lab level (maintainer ruling P7-C, 2026-10-02).
 *
 * Raising the Lab cuts what research costs and not how long it takes: the clock is the Researcher's
 * (with the crew's research points and the Lab's cards), the price is the Lab's and the
 * track officer's. It took 2 points a level off the clock until that day. At 1.5 a level a Lab at
 * 20 takes 30% off, the same as the best track officer, and the two multiply (`researchItemPrice`),
 * so no price falls below about half.
 */
export const RESEARCH_COST_PER_LAB_LEVEL = 1.5;

/** What the Lab's level takes off every research price, as a percentage. */
export function labResearchCostCut(buildings: readonly Building[]): number {
  return buildingLevel(buildings, 'lab') * RESEARCH_COST_PER_LAB_LEVEL;
}

/**
 * The district's points off a research clock: the research cards fitted, uncapped. The Lab's own
 * level stopped counting here on 2026-10-02 (P7-C): it cuts the price now.
 *
 * Points rather than a finished cut (maintainer, 2026-10-01: "make them add"). They join the crew's
 * research speed and the Researcher's cut on one sum, and {@link researchTimeCut} is the one
 * bound on it.
 */
export function researchTimeReduction(buildings: readonly Building[]): number {
  return districtEffects(buildings).research_time_reduction;
}

/**
 * The research clock's taper: in full to 30 points, then closing on 92% off, never reaching it.
 *
 * Sized against the old compound: a Lab 10 with Filed Drawings, a crew on 15 and a Head buying 20
 * is 55% off (was 50%); a Lab 20 with three research cards, a crew on 30 and a Head at the top is
 * 85% off (was 87%).
 */
export const RESEARCH_TIME_KNEE = 30;
export const RESEARCH_TIME_CEILING = 92;

/** Percent off a research clock for this many points, every source added. */
export function researchTimeCut(points: number): number {
  return softCap(points, RESEARCH_TIME_KNEE, RESEARCH_TIME_CEILING);
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

// --- the Gauntlet (§B6) and the Greenhouse (§B5): what mustering costs and how long it takes ---

/** Percentage points off every unit's muster clock, per Gauntlet level. */
export const MUSTER_TIME_PER_GAUNTLET_LEVEL = 2;
/** And the ceiling on it, before modifications. A maxed Gauntlet is 40 points on its own. */
export const MAX_GAUNTLET_MUSTER_BONUS = 40;

/**
 * §B6: how much faster this district musters, in percentage points.
 *
 * Applies to **every** unit on the roster, including the ones the Gauntlet cannot muster itself.
 * That is the maintainer's wording and it is the right rule: the Gauntlet is where a crew learns to
 * drill, and a Cyber Dog assembled in the Infirmary is still handled by people who learned the trade here.
 *
 * The Gauntlet's own contribution is capped separately from the modifications on top, so a maxed
 * Gauntlet is 40 points and a maxed Gauntlet carrying Salvaged Simulators is 52.
 */
export function musterTimeReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const gauntlet = Math.min(
    MAX_GAUNTLET_MUSTER_BONUS,
    buildingLevel(buildings, 'gauntlet') * MUSTER_TIME_PER_GAUNTLET_LEVEL,
  );
  return gauntlet + effects.muster_time_reduction;
}

/**
 * Percentage points off the **supplies** line of a muster bill, per Greenhouse level.
 *
 * Half a point (maintainer, 2026-10-01: "generally nerf the supply reduction bonuses so that it's
 * hard to get there and a mid game crew is expected to have reduced it by about 20% or so"). It was
 * 2 a level stopped at 30, which put a level 10 Greenhouse at 20 on its own and a mid-game crew
 * near 41% off the line with one card. A level 20 Greenhouse is 10 now, and nothing stops it: the
 * structure's own ceiling of 20 levels is the only bound, so every level still pays.
 */
export const MUSTER_SUPPLIES_PER_GREENHOUSE_LEVEL = 0.5;

/**
 * §B5: how much less supplies a unit costs to muster here, in percentage points.
 *
 * Supplies only, and that restriction is the whole point of the channel existing: the Greenhouse
 * grows food, so what it makes cheaper is the food a recruit eats while they learn, not the scrap
 * their armour is cut from. Folded on top of whatever general muster discount the crew and the
 * ground already carry, in `musterCost`, which applies the two to different lines of the bill.
 */
export function musterSuppliesReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const greenhouse = buildingLevel(buildings, 'greenhouse') * MUSTER_SUPPLIES_PER_GREENHOUSE_LEVEL;
  return greenhouse + effects.muster_supplies_reduction;
}
