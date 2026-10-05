import { MAX_RIGHT_HAND_LIFT, rightHandLift } from './effects.js';
import { markFromPoints, markIndex } from './marks.js';
import { chairPassivePercent, raidBossBodyTimes, traderRates } from './passives.js';
import { BARTER_RATE } from '../market/vendor.js';
import { SUPPLY_MARKUP } from '../market/supply.js';
import type { OfficerRole } from '../roles.js';

/**
 * A figure the way every chair line prints it: one decimal, no trailing `.0`. One grain for every
 * line, the research payload's (`PUBLISHED_CUT_GRAIN`), so no line says more about a seat's points
 * than the others do.
 */
function tenth(value: number): number {
  return Number(value.toFixed(1));
}

function pct(value: number): string {
  return `${tenth(value)}%`;
}

/**
 * What a chair does for the crew, and by how much, in the one line every screen prints for it
 * (maintainer, 2026-10-04: "have each officer's bonus say what it does and by how much").
 *
 * `points` is the seat's points of whoever is working it. The Trader's line reads the market's own
 * rates, which move with the crew's level, so a caller that knows them passes them; without, the
 * plain rates are used.
 */
export function describeChairPassive(
  role: OfficerRole,
  points: number,
  plainRates: { worth: number; markup: number } = { worth: BARTER_RATE, markup: SUPPLY_MARKUP },
  /**
   * What the Researcher actually adds once their cut joins the Lab's cards and the crew's on one
   * curved sum (`researchHead.addsPercent`), when the caller knows it. Without, the passive's own
   * figure, which is the most it can add.
   */
  researchAddsPercent?: number,
): string {
  switch (role) {
    case 'researcher':
      return `Makes all research ${pct(researchAddsPercent ?? chairPassivePercent('research_speed', points))} faster.`;
    case 'fixer':
      return `Adds ${pct(chairPassivePercent('payroll', points))} to your payroll.`;
    case 'steward':
      return `Adds ${pct(chairPassivePercent('unit_slots', points))} to your base unit slots.`;
    case 'field_commander':
      return `${pct(chairPassivePercent('battle_infamy', points))} more infamy from fights against other crews.`;
    case 'raid_boss':
      return `Multiplies his own damage and vitality by ${tenth(raidBossBodyTimes(points))} in every fight.`;
    case 'salvager':
      return `${pct(chairPassivePercent('scrapyard_cost', points))} off the scrap and HQ metal of everything the Scrapyard builds.`;
    case 'cartographer':
      return `Cuts ${pct(chairPassivePercent('travel_time', points))} off every road, before speed bonuses.`;
    case 'trader': {
      const rates = traderRates(points, plainRates.worth, plainRates.markup);
      return `The broker pays ${pct(rates.worth * 100)} of value and the supply sells at ${pct(rates.markup * 100)}.`;
    }
    case 'veteran':
      return `${pct(chairPassivePercent('muster_cost', points))} off the cost of mustering units.`;
    case 'engineer':
      return `${pct(chairPassivePercent('building_cost', points))} off building and upgrading your district's structures and the locations you hold.`;
    case 'professor':
      return `${pct(chairPassivePercent('mission_xp', points))} more experience from missions.`;
    case 'right_hand': {
      // Whole points, as the sheets take them (bug pass, 2026-10-05): every lift lands through
      // `clampAttribute`, which rounds, so a line saying 1.3 was over a sheet moved by 1.
      const lift = Math.round(rightHandLift(points, MAX_RIGHT_HAND_LIFT));
      return `Lifts every other officer by ${lift} ${lift === 1 ? 'point' : 'points'} in every skill.`;
    }
    case 'master_of_whispers':
      return 'Spies, and guards your crew against spies, at this grade.';
  }
}

/** The Overseer's one passive, in the same voice (`overseerLift`). */
export function describeOverseerPassive(points: number): string {
  const steps = markIndex(markFromPoints(points)) + 1;
  return `Lifts every seated officer by ${steps} ${steps === 1 ? 'point' : 'points'}, shared over their irreplaceable and essential skills.`;
}
