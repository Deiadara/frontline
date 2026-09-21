import type { TerritoryEffects } from '../city/locations.js';
import {
  findUnit,
  isCombatUnit,
  type Army,
  type UnitRuleId,
  type UnitSpec,
} from '../units/index.js';

/**
 * Who is standing in the line, and what their sheet says once the crew's holdings are on it.
 *
 * Its own module rather than part of `engine.ts` because it is read from both ends of the battle
 * package: the round loop builds its stacks with it, and `boosts.ts` has to ask the same question
 * to price how much of a force a bought name reaches. Importing the engine from there is a cycle,
 * and a cycle here is not a style point: `boosts.ts` is loaded first by some entry points, so
 * `bareLineRules` came back undefined at runtime while every unit test passed.
 */

/**
 * The two crew channels that change what a *sheet* is, rather than what a number on it is.
 *
 * A `Pick` of `TerritoryEffects` rather than the whole struct, so the helpers below can be called
 * from a test or from `sapperCutPercent` with a two-field literal instead of a fold nobody in that
 * context has. Every real caller passes a `CrewEffects`, which satisfies it.
 */
export type LineRules = Pick<TerritoryEffects, 'carriersFight' | 'unitMarks'>;

/** Nothing granted and nobody promoted: what a fight with no holdings behind it reads. */
export const bareLineRules = (): LineRules => ({ carriersFight: false, unitMarks: {} });

/**
 * Whether this unit takes a place in the line at all (`carriers_fight` in `city/locations.ts`).
 *
 * `combat: false` is otherwise the hardest rule in the game: the porters are not in the fight, and
 * the check lives here rather than at the doors precisely so nothing can forget it. This is the one
 * thing that lifts it, and it is a crew's own holding rather than a caller's argument, so a
 * defender who never chose their force is covered by it exactly as an attacker is.
 */
export function standsInLine(unit: UnitSpec, rules: LineRules): boolean {
  return isCombatUnit(unit) || rules.carriersFight;
}

/**
 * The sheet this crew actually fields, with whatever marks it has been granted written on.
 *
 * A copy of the spec with the flags set, rather than a second lookup at every read site. Every rule
 * in the engine asks `unit.<mark> === true`, so granting one here wires it into the round loop, the
 * targeting split, the medics and the report at once, and a mark added to `units/rules.ts` tomorrow
 * is grantable with no change to this function.
 */
export function markedUnit(unit: UnitSpec, rules: LineRules): UnitSpec {
  const granted = rules.unitMarks[unit.id];
  if (granted === undefined || granted.length === 0) return unit;
  const marks = Object.fromEntries(granted.map((mark: UnitRuleId) => [mark, true]));
  return { ...unit, ...marks };
}

/**
 * How big a force actually is, in the unit slots of everything that will stand in the line.
 *
 * ## Why slots
 *
 * A Juggernaut is not one body. Unit slots are what the game prices a force in everywhere a
 * player can see one: the beds a district has to find, the deployment screen, `supply_deployed`.
 * Counting heads would make "twice your own" a statement about how cheap the other crew's units
 * were, so a crew could walk a maxed line into a mob of Razors and call it an upset.
 *
 * ## Why only what stands
 *
 * Because the porters are not in the fight, and `simulate` has counted its own sides this way
 * since the day the rule was written: "Forty Scavengers behind twenty Razors were handing every
 * Warden and Juggernaut sent against them a last stand it had not earned." A crew defends its
 * home with its whole roster, warehouse staff included, and nobody chooses that. Measured on the
 * case `engine.ts` already records: 25 Breakers (50 slots) against 20 Razors, 40 Scavengers and
 * 30 Haulers reads as 120 slots of defence on the raw roster and 20 on the line that forms. The
 * attacker was being paid a win against six-to-one odds for beating twenty Razors.
 *
 * It cuts both ways, which is the half that is easy to miss: that defending crew's *own* force
 * also read 120, so the one side that was genuinely outnumbered could never earn the feat for it.
 *
 * `rules` is the side's own, because `carriers_fight` is a crew's holding rather than a fact
 * about the fight. A crew that has bought it has its porters in the line, they are counted, and
 * they are counted whole: the engine turns them out at {@link CARRIER_STRENGTH}, but that is how
 * hard they hit, not whether they are standing there, and the engine's own outnumbered flag does
 * not halve them either. One predicate, read the same way in both places.
 */
export function fightingSlots(army: Army, rules: LineRules): number {
  return Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    if (!unit || count <= 0 || !standsInLine(unit, rules)) return total;
    return total + unit.unitSlots * count;
  }, 0);
}
