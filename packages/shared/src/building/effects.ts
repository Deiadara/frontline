import {
  LOCAL_EFFECTS,
  MODIFICATION_EFFECTS,
  SET_BONUSES,
  findModification,
  type ModificationEffect,
  type ModificationFamily,
  type ModificationSpec,
} from './modifications.js';
import type { Building } from './state.js';

/**
 * What the district's installed modifications add up to (§A1).
 *
 * One pass over every structure, one total per effect, read by whichever formula owns that effect.
 * Nothing here knows *which* structure contributed. That is the point of a district-wide effect,
 * and it is why the one local effect is excluded and read separately by
 * {@link localProductionPercent}.
 */
export type DistrictEffects = Readonly<Record<ModificationEffect, number>>;

const ZERO: DistrictEffects = Object.freeze(
  Object.fromEntries(MODIFICATION_EFFECTS.map((effect) => [effect, 0])),
) as DistrictEffects;

/**
 * The ceiling on any single "less of a bad thing" effect, in percent.
 *
 * Reductions stack additively, and three structures' worth of the same effect could otherwise reach
 * 100%: a build that costs nothing and finishes instantly. Capped rather than made multiplicative
 * so a player reading "+20% off build time" on a card sees exactly 20 percentage points arrive,
 * right up until the cap tells them plainly that it did not.
 *
 * Seventy since 2026-09-16, and the ten points are the other half of lifting the top two grades.
 * Three MASTERPIECE cards of one reduction family come to 72 now, so at sixty a finished deck was
 * throwing away most of its third card: the grade got harder to reach and dearer to cut in the
 * same pass, and a ceiling that ate the difference would have made the climb worth less than
 * before rather than more. Still a ceiling, and still one a deep deck can feel.
 */
export const MAX_EFFECT_REDUCTION = 70;

/** Effects that are subtractions, and so need the {@link MAX_EFFECT_REDUCTION} ceiling. */
const REDUCTIONS: readonly ModificationEffect[] = [
  'build_cost_reduction',
  'build_time_reduction',
  'research_time_reduction',
  'training_time_reduction',
  'training_supplies_reduction',
];

/**
 * The cards actually fitted in one structure, dropping ids the catalogue no longer knows.
 *
 * A retired id is the ordinary state of a live save, so it is skipped rather than thrown on: this
 * sits on every read path in the game.
 */
export function fittedIn(building: Building): ModificationSpec[] {
  return building.modifications.flatMap((id) => {
    const spec = findModification(id);
    return spec ? [spec] : [];
  });
}

/**
 * What one card is worth in the company it is keeping.
 *
 * Its printed magnitude, plus its synergy bonus if any *other* card in the same structure carries
 * the family it wants. "Other" is doing real work: without it a card whose synergy names its own
 * family would pay the bonus for standing next to itself, which is a card that is strictly better
 * than every other card and needs no deck at all.
 */
export function fittedMagnitude(
  spec: ModificationSpec,
  beside: readonly ModificationSpec[],
): number {
  const wants = spec.synergy;
  if (!wants) return spec.magnitude;
  const met = beside.some((other) => other.id !== spec.id && other.family === wants.with);
  return met ? spec.magnitude + wants.bonus : spec.magnitude;
}

/**
 * The family a structure is *completely* built around, if it is built around one.
 *
 * Every slot filled, every card the same family, and more than one card: a single modification in
 * a one-slot structure is not a set, and treating it as one would hand the biggest bonus in the
 * system to a level-4 building with one card in it.
 */
export function completedSet(building: Building): ModificationFamily | null {
  const fitted = fittedIn(building);
  if (fitted.length < MODIFICATION_SET_SIZE) return null;
  const family = fitted[0]?.family;
  if (family === undefined) return null;
  return fitted.every((spec) => spec.family === family) ? family : null;
}

/** How many cards of one family make a set. The structure's full complement of slots. */
export const MODIFICATION_SET_SIZE = 3;

export function districtEffects(buildings: readonly Building[]): DistrictEffects {
  const totals: Record<ModificationEffect, number> = { ...ZERO };
  for (const building of buildings) {
    const fitted = fittedIn(building);
    for (const spec of fitted) {
      if (LOCAL_EFFECTS.includes(spec.effect)) continue;
      totals[spec.effect] += fittedMagnitude(spec, fitted);
    }
    /*
     * The set bonus, paid once per structure that earned it.
     *
     * Read here rather than folded into the cards so that a set is worth something the three cards
     * could not buy on their own: three Comfort cards raise housing, and completing the set buys
     * *more* housing on top, from the district rather than from the building.
     */
    const set = completedSet(building);
    if (set !== null) {
      const bonus = SET_BONUSES[set];
      if (!LOCAL_EFFECTS.includes(bonus.effect)) totals[bonus.effect] += bonus.magnitude;
    }
  }
  for (const effect of REDUCTIONS) {
    totals[effect] = Math.min(MAX_EFFECT_REDUCTION, totals[effect]);
  }
  return totals;
}

/** The `production_percent` a single structure's own modifications are worth to it. */
export function localProductionPercent(building: Building | undefined): number {
  if (!building) return 0;
  const fitted = fittedIn(building);
  let total = 0;
  for (const spec of fitted) {
    if (spec.effect === 'production_percent') total += fittedMagnitude(spec, fitted);
  }
  /*
   * A local set pays locally.
   *
   * `production_percent` is the one effect that belongs to the structure rather than the district,
   * so the Plumbing set, whose bonus is production, has to be read here. Paying it in
   * `districtEffects` instead would have been a set bonus that silently did nothing, which is the
   * failure this codebase has now had twice.
   */
  const set = completedSet(building);
  if (set !== null && SET_BONUSES[set].effect === 'production_percent') {
    total += SET_BONUSES[set].magnitude;
  }
  return total;
}

/** `value` with a percentage bonus applied. */
export function withBonus(value: number, percent: number): number {
  return value * (1 + percent / 100);
}

/** `value` with a percentage taken off it, floored at zero. */
export function withReduction(value: number, percent: number): number {
  return value * Math.max(0, 1 - Math.min(MAX_EFFECT_REDUCTION, percent) / 100);
}
