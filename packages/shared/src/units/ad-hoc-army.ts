import { findUnit, type UnitSpec } from './catalog.js';

/**
 * The Geppetto's AD HOC ARMY (maintainer, 2026-10-09), by the numbers.
 *
 * He starts a fight with robots beside him and makes more at the start of every round after, for
 * as long as he is in the fight. The Crate Ring's level sets the robots: level 1 is the base
 * sheet, levels 2 to 4 add 100 vitality and 20 damage a level, and level 5 keeps level 4's robots
 * and makes two a round instead of one. A crew that lost the ring fights them at level 1.
 */

export const GEPPETTO_ID = 'the_geppetto';
export const AD_HOC_ARMY_ID = 'ad_hoc_army';

/** Vitality and damage a robot gains for each Crate Ring level above the first, to level 4. */
export const AD_HOC_ARMY_LIFT = { vitality: 100, offense: 20 } as const;

/** The ring level past which the robots stop growing and start coming two at a time. */
const LAST_LIFT_LEVEL = 4;

/** How many Crate Ring levels of lift a robot carries: 0 at level 1 (or none), 3 from level 4. */
function liftSteps(level: number): number {
  return Math.max(0, Math.min(LAST_LIFT_LEVEL, Math.floor(level)) - 1);
}

/** Robots made at the start of every round, the first included: two at a level-5 ring. */
export function adHocArmyPerRound(level: number): number {
  return level >= 5 ? 2 : 1;
}

/** The rule's name as the card prints it: AD HOC ARMY, or AD HOC ARMY II at a level-5 ring. */
export function adHocArmyLabel(level: number): string {
  return level >= 5 ? 'Ad Hoc Army II' : 'Ad Hoc Army';
}

/** The robot's sheet at this Crate Ring level (0 when the crew does not hold the ring). */
export function adHocArmyAt(level: number): UnitSpec {
  const base = findUnit(AD_HOC_ARMY_ID);
  if (!base) throw new Error('the Ad Hoc Army is missing from the catalogue');
  const steps = liftSteps(level);
  if (steps === 0) return base;
  return {
    ...base,
    stats: {
      ...base.stats,
      vitality: base.stats.vitality + AD_HOC_ARMY_LIFT.vitality * steps,
      offense: base.stats.offense + AD_HOC_ARMY_LIFT.offense * steps,
    },
  };
}
