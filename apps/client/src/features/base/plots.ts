import type { BuildingKind } from '@frontline/shared';

/**
 * Where each structure stands in the hideout (GDD §A1 — a small village laid out like Grepolis'
 * town view, not a list).
 *
 * Coordinates are percentages of the scene box, so the village scales with its container and can
 * never be positioned off the edge by a viewport it was not measured at. A plot box covers the
 * sprite **and** its name plate, and `plots.test.ts` pins that no two boxes intersect: the board's
 * bar is zero overlapping elements, which a hand-placed layout would otherwise only satisfy at
 * whatever width it happened to be eyeballed at.
 *
 * Back row sits higher and smaller than the front row, which is the whole depth cue — there is no
 * z-ordering to get wrong because nothing overlaps.
 *
 * Every plot's width is half its height, because {@link VILLAGE_ASPECT} is 2:1 — that makes the box
 * square in *pixels*. The sprites are drawn square and fitted with `meet`, so any other plot shape
 * letterboxes them and draws the village smaller than the space it is taking up.
 */
export interface VillagePlot {
  kind: BuildingKind;
  /** Left edge, percent of scene width. */
  x: number;
  /** Top edge, percent of scene height. */
  y: number;
  /** Percent of scene width. */
  width: number;
  /** Percent of scene height. */
  height: number;
}

/** Scene width ÷ height. Wide and shallow so the whole village clears the fold at 1024x768. */
export const VILLAGE_ASPECT = 2;

/**
 * Where the far ground meets the sky, percent of scene height.
 *
 * Set to the back row's baseline so the skyline sits *behind* those structures rather than cutting
 * across them. Deliberately not drawn as a hard line: a sprite is fitted above its name plate, so
 * its feet land a plate's height short of its plot's bottom edge — a px quantity no percentage can
 * name — and a crisp horizon would show that gap as a ledge the buildings float over.
 */
export const VILLAGE_HORIZON = 42;

export const VILLAGE_PLOTS: readonly VillagePlot[] = [
  { kind: 'reactor', x: 8, y: 6, width: 18, height: 36 },
  { kind: 'command_center', x: 40, y: 2, width: 20, height: 40 },
  { kind: 'data_hub', x: 74, y: 6, width: 18, height: 36 },
  { kind: 'foundry', x: 6, y: 48, width: 22, height: 44 },
  { kind: 'barracks', x: 39, y: 48, width: 22, height: 44 },
  { kind: 'wall', x: 72, y: 48, width: 22, height: 44 },
];
