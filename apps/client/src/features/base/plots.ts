import {
  ASSET_CLASS_SPECS,
  BUILDING_KINDS,
  findAssetSpec,
  type BuildingKind,
} from '@frontline/shared';

/**
 * Where each structure stands in the district (GDD §A1: a place laid out like Grepolis' town
 * view, not a list).
 *
 * ## The plate paints the buildings, so a site is a silhouette
 *
 * `plate-district` used to be *ground*: an empty terrace with lots on it, and each structure was a
 * cutout master pasted onto its lot. The delivered plate is a finished painting of a district with
 * the buildings already in it, which turns the layout inside out. There is nothing left to paste:
 * the Quarters are already drawn, at an angle nothing but that painting knows, so what the layout
 * has to carry is no longer *where to put a box* but **which pixels are which building**.
 *
 * A site is therefore a polygon traced around the building on the plate, and the whole interaction
 * layer is those polygons: hover lights one, click opens its dialog. The old model: centre, ground
 * line, box sized to the master's aspect: has no job left, and keeping it would have meant hit
 * areas that are rectangles over a painting where nothing is a rectangle: the Scrapyard's box would
 * have swallowed the Cistern beside it, and the Gate's would have covered the road it stands over.
 *
 * The masters in `art-src/building-*.png` are not wasted. They are what the structure's dialog shows
 * as its portrait, see `StructureDialog`, which is where an icon of a building is actually useful.
 *
 * ## Coordinates
 *
 * Percentages of the scene box, so the district scales with its container and can never be
 * positioned off the edge by a viewport it was not measured at. Vertices run clockwise.
 *
 * Every polygon was traced against the plate itself under a printed grid, then rendered back over
 * the painting and checked by eye, which is why they are irregular. `plots.test.ts` pins the
 * properties that survive that process being redone: inside the frame, convex, non-overlapping, and
 * a shape rather than a box.
 */
export type ScenePoint = readonly [number, number];

export interface DistrictSite {
  kind: BuildingKind;
  /** The building's outline on the plate, clockwise, in percent of the scene box. */
  shape: readonly ScenePoint[];
}

/**
 * The delivered plate's pixel size, and the scene's shape, taken from the asset rather than
 * declared.
 *
 * The plate is a *map*: every polygon below is traced on one specific painting, so the scene has to
 * be the shape that painting is. Writing the ratio down here as well would give it two sources, and
 * the day they disagreed every one of the twelve outlines would slide off its building at once.
 *
 * The pixel size is the SVG overlay's `viewBox`, which is what keeps a stroke the same weight in
 * both axes: a `viewBox` of `0 0 100 100` stretched onto a 16:9 box draws a horizontal outline
 * thinner than a vertical one.
 */
const PLATE = findAssetSpec('plate-district') ?? ASSET_CLASS_SPECS.plate;

export const DISTRICT_PLATE = { width: PLATE.width, height: PLATE.height } as const;

export const DISTRICT_ASPECT = PLATE.width / PLATE.height;

/**
 * The compound's back boundary, percent of scene height. Used by the stand-in ground only.
 *
 * There is no horizon and no sky. The camera looks *down* at the district: the whole frame is
 * ground, so the top of the plate is the far side of the neighbourhood, not the place the land
 * meets the air.
 */
export const DISTRICT_BACK_EDGE = 5;

/** The outline in `viewBox` units, ready for an SVG `points` attribute. */
export function sitePoints(site: DistrictSite): string {
  return site.shape
    .map(
      ([x, y]) =>
        `${((x / 100) * DISTRICT_PLATE.width).toFixed(1)},${((y / 100) * DISTRICT_PLATE.height).toFixed(1)}`,
    )
    .join(' ');
}

/** Twice the signed area of the outline. Positive because the vertices run clockwise on screen. */
export function siteArea(site: DistrictSite): number {
  const points = site.shape;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i] as ScenePoint;
    const [x2, y2] = points[(i + 1) % points.length] as ScenePoint;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * The outline's area centroid: where the name plate hangs.
 *
 * The mean of the vertices is not this, and the difference is visible: a building traced with six
 * points along its lit roof and two at its base would pull a vertex mean up onto the roof. The area
 * centroid sits in the middle of the *shape*, which is where a label reads as belonging to it.
 */
export function siteCentroid(site: DistrictSite): { x: number; y: number } {
  const points = site.shape;
  const area = siteArea(site);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i] as ScenePoint;
    const [x2, y2] = points[(i + 1) % points.length] as ScenePoint;
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** The outline's bounding box, in percent of the scene: what a badge hung on it is sized from. */
export function siteBounds(site: DistrictSite): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = site.shape.map(([x]) => x);
  const ys = site.shape.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * How near the front of the district a structure stands: the lowest point of its outline.
 *
 * The ground line, in other words: the same thing the old model stored as a `baseline`, except read
 * off the tracing instead of typed beside it, so it cannot disagree with the shape it describes.
 */
export function siteDepth(site: DistrictSite): number {
  return Math.max(...site.shape.map(([, y]) => y));
}

const site = (kind: BuildingKind, shape: readonly ScenePoint[]): DistrictSite => ({ kind, shape });

/**
 * The twelve structures, as they are painted.
 *
 * Read top-left to bottom-right across the plate, which is roughly back to front. Sizes vary
 * enormously and that is the painting's doing rather than a design decision: the Quarters block and
 * the Scrapyard's fenced lot are the two biggest things in the district, and the Cistern is one
 * riveted tank.
 */
export const DISTRICT_SITES: readonly DistrictSite[] = [
  // The tenement stack: three storeys of shanty around a gabled core, and the biggest silhouette
  // in the district. Traced down to the lower storey rather than stopping at the middle floor:
  // the first tracing cut it off at y=27 and left the ground floor outside its own building.
  site('quarters', [
    [22, 0.8],
    [26, 2.5],
    [30.5, 7],
    [31, 14],
    [29.5, 21],
    [27.5, 26.5],
    [22, 30],
    [16, 27],
    [13, 22],
    [12.5, 14],
    [14, 7],
  ]),
  site('lab', [
    [39.5, 9],
    [42, 1],
    [50, 2.5],
    [52, 13],
    [50.5, 17],
    [43, 18],
    [39.5, 13],
  ]),
  site('greenhouse', [
    [77.5, 25],
    [87, 14.5],
    [96.5, 19],
    [96.5, 30],
    [85, 36.5],
    [77.5, 31],
  ]),
  site('apothecary', [
    [40.5, 33],
    [43, 28],
    [50, 29],
    [51, 38],
    [47, 43],
    [41.5, 40],
  ]),
  site('gauntlet', [
    [19, 41],
    [23, 30.5],
    [32, 33],
    [33, 44],
    [28, 50],
    [21, 48],
  ]),
  site('nexus', [
    [54.5, 33],
    [57, 22],
    [63, 24],
    [65, 44],
    [61, 52],
    [55, 47],
  ]),
  // The plant on the canal: a stack, a duct and a boiler drum, standing over the water.
  site('generator', [
    [83, 38.5],
    [89, 40],
    [90, 45],
    [90.5, 52],
    [90, 58],
    [86, 59.5],
    [83, 54],
    [80.8, 46.5],
    [81.5, 42],
  ]),
  site('garage', [
    [64.5, 57],
    [68, 51],
    [76, 54],
    [76, 63],
    [71, 67],
    [65, 64],
  ]),
  // A drum with a domed cap: nine points because a cylinder traced with four is a crate.
  site('cistern', [
    [12, 59.6],
    [14, 61],
    [14.7, 63.5],
    [14.6, 67],
    [12.6, 69.8],
    [10.6, 69.8],
    [9.4, 67],
    [9.3, 63.3],
    [10.3, 61],
  ]),
  site('scrapyard', [
    [4.5, 73],
    [11, 70.8],
    [17, 70.5],
    [24, 75],
    [24.5, 82],
    [19, 90],
    [10, 91],
    [4, 85],
  ]),
  // The way in and out, so it is the painted breach in the timber wall rather than a lot. The only
  // outline here with four corners, and honestly so: the wall is a straight run of palisade seen
  // side-on, and it runs downhill across the bottom of the frame, so the shape it makes is a
  // parallelogram. Adding vertices to it would be decoration rather than tracing.
  site('gate', [
    [30, 68.8],
    [47, 74.2],
    [47, 86],
    [30, 79.6],
  ]),
  site('infirmary', [
    [79, 79],
    [84, 70],
    [94, 74],
    [95, 84],
    [88, 91],
    [80, 87],
  ]),
];

/**
 * The band of the plate the buildings actually occupy, percent of scene height.
 *
 * Read off the tracings rather than typed, because it is a *consequence* of them: re-trace the
 * Quarters' roofline and this moves with it. What it is for is the one measurement the scene cannot
 * make from the picture alone: the plate's top and bottom edges are empty ground, so a viewport
 * that cannot show the whole painting between the floating HUD and the scenery switcher can still
 * show every building between them, by letting the *margins* pass under the chrome instead of the
 * structures. Without it the district either shrinks into the middle of the screen or puts the
 * Quarters behind the stockpile.
 */
/**
 * Room under the lowest building for the name plate that hangs there.
 *
 * Percent of the plate's height, and it is a *layout* allowance rather than a fact about the
 * painting: every structure's control is a plate anchored at its ground line and hanging below it
 * (`DistrictScene`), so a band that stopped at the last traced vertex would let the Scrapyard's and
 * the Infirmary's plates hang into the scenery switcher: visible, and unclickable.
 *
 * Five percent, and sized against the **smallest** plate the game draws rather than the typical
 * one, which is the whole trap here. The allowance is a share of the picture and the plate is a
 * fixed twenty-two pixels of type, so an allowance tuned at 1440×900 is too small at 1024×768,
 * where the picture is little more than half the height. Three percent measured fine on a desk and
 * put the Scrapyard's and the Infirmary's plates under the in-flight rail on a laptop.
 *
 * Paired with the plate hanging three quarters below its anchor rather than fully below it
 * (`DistrictScene`), which is the other half of the same sum.
 */
export const LABEL_ALLOWANCE = 5;

export const DISTRICT_BAND = {
  top: Math.min(...DISTRICT_SITES.flatMap((s) => s.shape.map(([, y]) => y))),
  bottom: Math.min(
    100,
    Math.max(...DISTRICT_SITES.flatMap((s) => s.shape.map(([, y]) => y))) + LABEL_ALLOWANCE,
  ),
} as const;

/**
 * Painting order: farthest first, so a nearer outline's glow and scrim draw over a taller far one
 * where the painting has them pass in front of each other.
 *
 * Sorted here rather than relied on above, so the table stays readable as a description of the
 * *place* and a structure can be re-traced without also being moved in the list.
 */
export const DISTRICT_SITES_BY_DEPTH: readonly DistrictSite[] = [...DISTRICT_SITES].sort(
  (a, b) => siteDepth(a) - siteDepth(b),
);

/**
 * Guards at module load that the layout covers the catalogue exactly: no structure without a
 * building on the plate, and no outline for a structure that no longer exists.
 */
if (DISTRICT_SITES.length !== BUILDING_KINDS.length) {
  throw new Error(
    `${DISTRICT_SITES.length} outlines for ${BUILDING_KINDS.length} structures: the district layout is out of step with the catalogue`,
  );
}
