import {
  LOCAL_EFFECTS,
  MODIFICATION_EFFECTS,
  findModification,
  type ModificationEffect,
} from './modifications.js';
import type { Building } from './state.js';

/**
 * What the district's installed modifications add up to (§A1).
 *
 * One pass over every structure, one total per effect, read by whichever formula owns that effect.
 * Nothing here knows *which* structure contributed — that is the point of a district-wide effect,
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
 * 100% — a build that costs nothing and finishes instantly. Capped rather than made multiplicative
 * so a player reading "+20% off build time" on a card sees exactly 20 percentage points arrive,
 * right up until the cap tells them plainly that it did not.
 */
export const MAX_EFFECT_REDUCTION = 60;

/** Effects that are subtractions, and so need the {@link MAX_EFFECT_REDUCTION} ceiling. */
const REDUCTIONS: readonly ModificationEffect[] = [
  'build_cost_reduction',
  'build_time_reduction',
  'power_draw_reduction',
  'research_time_reduction',
  'hardship_reduction',
  'fuel_efficiency',
];

export function districtEffects(buildings: readonly Building[]): DistrictEffects {
  const totals: Record<ModificationEffect, number> = { ...ZERO };
  for (const building of buildings) {
    for (const id of building.modifications) {
      const spec = findModification(id);
      // An id with no catalogue entry is a modification that was retired under a live save. It
      // contributes nothing rather than throwing: this sits on every read path in the game.
      if (!spec || LOCAL_EFFECTS.includes(spec.effect)) continue;
      totals[spec.effect] += spec.magnitude;
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
  let total = 0;
  for (const id of building.modifications) {
    const spec = findModification(id);
    if (spec?.effect === 'production_percent') total += spec.magnitude;
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
