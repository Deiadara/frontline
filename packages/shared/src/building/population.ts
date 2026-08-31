import type { TerritoryEffects } from '../city/locations.js';
import {
  findUnit,
  supplyUsed,
  supplyQueued,
  type Army,
  type TrainingQueue,
} from '../units/index.js';
import { populationCapacity, type Building } from './index.js';

/**
 * Population (GDD §A1, §A4): the one pool everybody in the district draws on.
 *
 * There used to be two ceilings and they did not know about each other. The Quarters housed
 * the officers; the Gauntlet supplied an army; and a crew could fill both to the brim
 * without either noticing, so "how big is this crew" had two answers and neither was the whole
 * truth. A district that is three quarters barracks should not also have room for nineteen
 * officers, and the version with two counters could not say so.
 *
 * One pool now. The Quarters raise it and captured ground raises it, because people who work for
 * you have to sleep somewhere and the ground you hold is where the somewhere is.
 *
 * ## Officers do not draw on it (board rule)
 *
 * The army does, and only the army. Nineteen officers against a ceiling in the hundreds was a
 * rounding error that still had to be explained on every screen that showed the number, and it made
 * hiring somebody compete with training somebody, which is not a trade the game wants a player to
 * make: the crew is who you *are*, the army is what you can field. `officers` is still counted and
 * still reported, because "how many are on the books" is worth showing; it is simply not in
 * `total`.
 *
 * ## Why units cost their supply rather than their headcount
 *
 * A Colossus is not one person. Supply is the figure the roster already used for exactly this and
 * it is deliberately sub-linear against strength: a unit five times as dangerous as another tends
 * to cost four times the population, so the heavy end of the roster is *efficient* per bed as well
 * as expensive per cap. That is the trade the board asked for, and it is what stops a maxed
 * district being an ocean of Razors.
 */

/** Population every held location adds, whatever it is. Ground you hold is ground people live on. */
export const POPULATION_PER_LOCATION = 20;

/**
 * What the district can house: the structures, plus the ground.
 *
 * `populationCapacity` is the Quarters; `effects.populationBonus` is what the map adds, which is
 * `POPULATION_PER_LOCATION` for every location held plus whatever the handful of locations that
 * house people explicitly give on top.
 */
export function districtPopulationCapacity(
  buildings: readonly Building[],
  effects: Pick<TerritoryEffects, 'populationBonus'>,
): number {
  return populationCapacity(buildings) + Math.max(0, effects.populationBonus);
}

export interface PopulationDraw {
  /** Officers on the books. Reported, never charged: see the note at the top. */
  officers: number;
  /** Supply of everything standing on the roster, garrisons on held ground included. */
  army: number;
  /** Supply of everything on the bench, counted at order time so a batch cannot overfill on landing. */
  training: number;
  total: number;
}

/**
 * Everyone the district is currently housing, broken out.
 *
 * Returned as its parts rather than a single number because the screen has to be able to say
 * *what* is full: "you have no room" is a dead end, and "eleven of your fourteen beds are army" is
 * a decision.
 */
export function populationDraw(input: {
  commanders: readonly { readonly id: string }[];
  army: Army;
  trainingQueue: TrainingQueue;
  /** Units standing on captured ground. Still this crew's people, and still eating. */
  garrison?: Army;
}): PopulationDraw {
  const officers = input.commanders.length;
  const army = supplyUsed(input.army) + (input.garrison ? supplyUsed(input.garrison) : 0);
  const training = supplyQueued(input.trainingQueue);
  // Officers are outside the total on purpose. See the note at the top of the file.
  return { officers, army, training, total: army + training };
}

/** What one of these costs against the pool. The roster's own supply figure, and nothing new. */
export function populationCostOf(unitId: string): number {
  return findUnit(unitId)?.supply ?? 0;
}
