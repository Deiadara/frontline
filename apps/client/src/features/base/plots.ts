import {
  ASSET_CLASS_SPECS,
  BUILDING_KINDS,
  findAssetSpec,
  type BuildingKind,
} from '@frontline/shared';
import { STRUCTURE_ASPECT } from './masters.js';

/**
 * Where each structure stands in the district (GDD §A1 — a place laid out like Grepolis' town
 * view, not a list).
 *
 * A site is a **ground contact point plus a size**, not a grid cell. `x` is the centre of the
 * footprint and `baseline` is the line the structure stands on, so the box is anchored by its
 * *bottom edge* rather than its top: that is the one edge the painted plate cares about, and it is
 * what lets a site be nudged onto a lot without also re-deriving a top.
 *
 * Coordinates are percentages of the scene box, so the district scales with its container and can
 * never be positioned off the edge by a viewport it was not measured at.
 *
 * **Every site is a lot the plate actually paints.** These numbers are not a layout the art was
 * asked to accommodate — they were read off `plate-district` itself, lot by lot, and each one is an
 * enclosed patch of flat ground with roads and shanties around it. That is why nothing overlaps and
 * why the streets read as streets: the painting put them there.
 *
 * The Gate is the exception, and deliberately so — see {@link DISTRICT_SITES}.
 */
export interface DistrictSite {
  kind: BuildingKind;
  /** Centre of the footprint, percent of scene width. */
  x: number;
  /** The ground line the structure stands on, percent of scene height. */
  baseline: number;
  /** Percent of scene width. */
  width: number;
  /** Percent of scene height. */
  height: number;
}

/**
 * Scene width ÷ height, taken from the delivered plate rather than declared.
 *
 * The plate is a *map*: every site below is a point on a specific painting, so the scene has to be
 * the shape that painting is. Writing the ratio down here as well would give it two sources, and
 * the day they disagreed every one of the twelve sites would slide off its lot at once.
 */
export const DISTRICT_ASPECT = (() => {
  const spec = findAssetSpec('plate-district') ?? ASSET_CLASS_SPECS.plate;
  return spec.width / spec.height;
})();

/**
 * The compound's back boundary, percent of scene height. Nothing stands above it.
 *
 * There is no horizon and no sky. The camera looks *down* at the district — the whole frame is
 * ground — so the top of the plate is the far side of the neighbourhood, not the place the land
 * meets the air. It is the shanty band the plate paints across the top edge, which is scenery
 * rather than buildable ground.
 */
export const DISTRICT_BACK_EDGE = 5;

/** A structure's box, in the same percent-of-scene units, resolved from its anchor. */
export function siteBox(site: DistrictSite): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: site.x - site.width / 2,
    y: site.baseline - site.height,
    width: site.width,
    height: site.height,
  };
}

/**
 * The box height that lets a master of `aspect` (width ÷ height) fill a box of `width` exactly.
 *
 * Percent-of-width and percent-of-height are different units on a non-square scene, so a box's
 * shape is not `width / height`. Deriving every height through this rather than typing it is what
 * keeps the box equal to the *art*: a structure is drawn `object-contain`, so a box taller than its
 * master leaves a band of dead hit area over the roof, and a box wider than it shrinks the building
 * to fit a size nobody chose.
 */
export function boxHeight(width: number, aspect: number): number {
  return Math.round(((width * DISTRICT_ASPECT) / aspect) * 10) / 10;
}

const site = (kind: BuildingKind, x: number, baseline: number, width: number): DistrictSite => ({
  kind,
  x,
  baseline,
  width,
  height: boxHeight(width, STRUCTURE_ASPECT[kind]),
});

/**
 * The twelve sites, back to front.
 *
 * Eleven of them are lots on `plate-district`: an enclosed patch of flat ground with a road or a
 * fence on every side. The order below is the order they recede, which is also the order they
 * paint, and the sizes vary because the lots do — the Quarters and the Gauntlet stand on the two
 * biggest, the back row on the smallest.
 *
 * **The Gate has no lot, and should not have one.** It is the way in and out of the compound, so a
 * plot in the middle of the district would be the one placement that makes no sense. It stands on
 * the timber perimeter wall the plate paints across the bottom-left, over the gap already painted
 * into it — which is why its baseline is nearly at the frame's edge and its box is the only one
 * that does not sit inside a fenced square.
 */
export const DISTRICT_SITES: readonly DistrictSite[] = [
  // Back row — the late unlocks, along the top of the compound.
  site('lab', 60.1, 25.0, 13.7),
  site('apothecary', 75.2, 26.0, 13.4),
  site('cistern', 41.3, 28.4, 13.2),
  site('infirmary', 26.2, 34.1, 14.2),
  // Middle — the working district, with the Nexus on the centre lot.
  site('garage', 86.3, 43.2, 11.6),
  site('scrapyard', 10.4, 44.5, 17.3),
  site('greenhouse', 40.5, 44.9, 13.3),
  site('nexus', 53.5, 52.7, 13.0),
  site('quarters', 73.7, 64.5, 15.1),
  // Front — the largest lots, and the perimeter wall.
  site('gauntlet', 31.9, 77.1, 18.8),
  site('generator', 60.6, 83.3, 13.5),
  site('gate', 12.7, 91.1, 17.0),
];

/**
 * Painting order: farthest first, so a nearer structure draws over a taller far one where their
 * *art* passes in front of it, even though their lots never meet.
 *
 * Sorted here rather than relied on above, so the table stays readable as a description of the
 * *place* and a site can be moved between rows without also being moved in the list.
 */
export const DISTRICT_SITES_BY_DEPTH: readonly DistrictSite[] = [...DISTRICT_SITES].sort(
  (a, b) => a.baseline - b.baseline,
);

/**
 * Guards at module load that the layout covers the catalogue exactly — no structure without a site
 * to stand on, and no site for a structure that no longer exists.
 */
if (DISTRICT_SITES.length !== BUILDING_KINDS.length) {
  throw new Error(
    `${DISTRICT_SITES.length} sites for ${BUILDING_KINDS.length} structures — the district layout is out of step with the catalogue`,
  );
}
