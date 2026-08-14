import { BUILDING_KINDS, type BuildingKind } from '@frontline/shared';

/**
 * Where each structure stands in the district (GDD §A1 — a place laid out like Grepolis' town
 * view, not a list).
 *
 * Coordinates are percentages of the scene box, so the district scales with its container and can
 * never be positioned off the edge by a viewport it was not measured at. A plot box covers the
 * sprite **and** its name plate, and `plots.test.ts` pins that no two boxes intersect: the board's
 * bar is zero overlapping elements, which a hand-placed layout would otherwise only satisfy at
 * whatever width it happened to be eyeballed at.
 *
 * Three rows, back to front, each row shorter and wider than the one behind it — that is the whole
 * depth cue, and there is no z-ordering to get wrong because nothing overlaps.
 *
 * Every plot's width is half its height, because {@link DISTRICT_ASPECT} is 2:1 — that makes the
 * box square in *pixels*. The sprites are drawn square and fitted with `meet`, so any other plot
 * shape letterboxes them and draws the district smaller than the space it is taking up. The rows
 * below are therefore laid out by naming a height and letting the width follow, never both.
 */
export interface DistrictPlot {
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

/** Scene width ÷ height. Wide and shallow so the whole district clears the fold at 1024x768. */
export const DISTRICT_ASPECT = 2;

/**
 * Where the far ground meets the sky, percent of scene height.
 *
 * Set to the back row's baseline so the skyline sits *behind* those structures rather than cutting
 * across them. Deliberately not drawn as a hard line: a sprite is fitted above its name plate, so
 * its feet land a plate's height short of its plot's bottom edge — a px quantity no percentage can
 * name — and a crisp horizon would show that gap as a ledge the buildings float over.
 */
export const DISTRICT_HORIZON = 32;

interface Row {
  /** Top edge, percent of scene height. */
  y: number;
  /** Percent of scene height. Width is half of this — see the note above. */
  height: number;
  kinds: readonly BuildingKind[];
}

/**
 * The three rows.
 *
 * Placement is by *reading order of the game*, not by alphabet: the five structures a player
 * touches in their first session sit across the middle at eye level with the Nexus dead centre,
 * the Gate is at the front because it is the perimeter, and the late unlocks fill the back. A
 * player who has built four things sees them clustered, not scattered across an empty lot.
 */
const ROWS: readonly Row[] = [
  { y: 3, height: 28, kinds: ['cistern', 'apothecary', 'lab', 'infirmary'] },
  { y: 34, height: 32, kinds: ['generator', 'quarters', 'nexus', 'greenhouse', 'scrapyard'] },
  { y: 68, height: 30, kinds: ['gate', 'commons', 'gauntlet', 'garage'] },
];

/**
 * Spreads a row evenly across the full width, with equal gutters at both ends.
 *
 * Computed rather than typed out so the numbers cannot be nudged out of alignment one plot at a
 * time, and so adding a structure to a row is a one-word edit that stays symmetric.
 */
function layOut({ y, height, kinds }: Row): DistrictPlot[] {
  const width = height / DISTRICT_ASPECT;
  const gutter = (100 - kinds.length * width) / (kinds.length + 1);
  return kinds.map((kind, index) => ({
    kind,
    x: gutter * (index + 1) + width * index,
    y,
    width,
    height,
  }));
}

export const DISTRICT_PLOTS: readonly DistrictPlot[] = ROWS.flatMap(layOut);

/**
 * Guards at module load that the layout covers the catalogue exactly — no structure without a plot
 * to stand on, and no plot for a structure that no longer exists.
 */
if (DISTRICT_PLOTS.length !== BUILDING_KINDS.length) {
  throw new Error(
    `${DISTRICT_PLOTS.length} plots for ${BUILDING_KINDS.length} structures — the district layout is out of step with the catalogue`,
  );
}
