import { clampMeter, type Meter } from '../economy/meters.js';
import { districtEffects, MAX_EFFECT_REDUCTION } from './effects.js';
import { powerGrid } from './power.js';
import { buildingLevel, type Building } from './state.js';

/**
 * What the district is worth to the crew standing in it (§A1).
 *
 * Six structures reach the crew through this module: the Quarters and the Generator set what morale
 * settles at, the Gate sets what a raider has to beat, the Lab shortens research, the Gauntlet pays
 * officers more for the same work, and the Infirmary takes the edge off a bad week. Five of them do
 * their *whole* job here — the Quarters is the exception, because it also houses people, and that
 * is `population.ts`. Everything else is one exported function, so "what does the Infirmary actually
 * do" has exactly one answer.
 */

// --- morale (§D4): a level the district holds, not an event ---

/**
 * Morale is modelled as a **target the district drifts towards**, not as a number structures add
 * to.
 *
 * This is the difference between a mechanic and a rounding error. A flat bonus applied per
 * settlement would pay a player for refreshing the page, and a per-hour trickle would pay them for
 * staying away; drifting towards a target is frequency-independent — the same elapsed time gives
 * the same answer however many times it was read along the way.
 *
 * Events still move morale directly: a mission comes home (`MISSION_MORALE_DELTA`), a payday is
 * missed (`moralePenaltyFor`). The drift is what pulls the meter back towards whatever the district
 * can actually sustain, which is what the Quarters is buying.
 */
export const BASE_MORALE_TARGET = 55;
export const MORALE_PER_QUARTERS_LEVEL = 2;
/** Lit, warm and with power to spare. */
export const POWER_SURPLUS_MORALE = 6;
/** Cold and dark, scaled by how far short the grid is falling. */
export const BROWNOUT_MORALE = -20;
/** Half the gap between morale and its target closes every this many hours. */
export const MORALE_HALF_LIFE_HOURS = 12;

/** Where this district's morale settles if nothing else happens to it. */
export function moraleTarget(buildings: readonly Building[]): Meter {
  const effects = districtEffects(buildings);
  const grid = powerGrid(buildings);
  const power = grid.brownout ? BROWNOUT_MORALE * (1 - grid.ratio) : POWER_SURPLUS_MORALE;

  return clampMeter(
    BASE_MORALE_TARGET +
      buildingLevel(buildings, 'quarters') * MORALE_PER_QUARTERS_LEVEL +
      effects.morale_flat +
      power,
  );
}

/**
 * `current` moved `hours` towards `target` on an exponential approach.
 *
 * Exponential rather than linear so it cannot overshoot: the gap is always multiplied by a positive
 * fraction, so morale approaches the target from whichever side it started on and never crosses it.
 */
export function driftMorale(current: Meter, target: Meter, hours: number): Meter {
  if (hours <= 0) return current;
  const gapKept = 0.5 ** (hours / MORALE_HALF_LIFE_HOURS);
  return clampMeter(target + (current - target) * gapKept);
}

// --- the Gate (§A1: protection from raids) ---

export const DEFENSE_PER_GATE_LEVEL = 6;

/**
 * What a raider has to beat before they touch anything behind it.
 *
 * Added to the target's own difficulty by the battle engine, so a well-gated district is harder to
 * take than a bare one on the same ground. It is read for *whichever side is defending* — which is
 * why the bot rival's Gate already makes a difference today, and why a player's own Gate starts
 * paying the moment crews can raid each other.
 */
export function districtDefense(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const gate = buildingLevel(buildings, 'gate') * DEFENSE_PER_GATE_LEVEL;
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

/** Percentage points the Infirmary takes off a missed payday or a starved week (§D4). */
export const HARDSHIP_PER_INFIRMARY_LEVEL = 2;

export function hardshipReduction(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  return Math.min(
    MAX_EFFECT_REDUCTION,
    buildingLevel(buildings, 'infirmary') * HARDSHIP_PER_INFIRMARY_LEVEL +
      effects.hardship_reduction,
  );
}

/** Percentage points on what a won raid brings home. Modifications only — no structure grants it. */
export function raidLootBonus(buildings: readonly Building[]): number {
  return districtEffects(buildings).raid_loot_percent;
}
