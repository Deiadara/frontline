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
 * have swallowed the tank beside it, and the Gate's would have covered the road it stands over.
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
  /**
   * Percentage points to move this structure's name plate off its own centroid.
   *
   * For the handful of buildings whose middle is the one part of the painting worth looking at.
   * The outline is unchanged, so it moves the label and nothing else.
   */
  labelShift?: { x?: number; y?: number };
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

/**
 * The most the district picture may be compressed vertically to fit the room between the bars.
 *
 * Eight percent, which is about the point at which a painting of a slum still reads as the same
 * painting: past it the buildings start to look squat. It buys the step back that keeps the far
 * side of the district, where the tallest buildings are, out from behind the stockpile. Spent by
 * `fitted` in `DistrictScene`, and read by the layout gate that measures the result.
 *
 * It lives here rather than beside `fitted` because the gate has to import it and the gate cannot
 * import a component: `DistrictScene` pulls in the asset loader, which is `import.meta.glob` and
 * only exists inside Vite.
 */
export const MAX_SQUASH = 0.16;

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

const site = (
  kind: BuildingKind,
  shape: readonly ScenePoint[],
  labelShift?: { x?: number; y?: number },
): DistrictSite => ({ kind, shape, ...(labelShift ? { labelShift } : {}) });

/**
 * The eleven structures, as they are painted.
 *
 * Read top-left to bottom-right across the plate, which is roughly back to front. Sizes vary
 * enormously and that is the painting's doing rather than a design decision: the Quarters block and
 * the Scrapyard's fenced lot are the two biggest things in the district.
 *
 * §A2 removed the Cistern's outline and **nothing else**: the painting is untouched, so the tank
 * is still drawn on the plate. What went is the tag over it, which is exactly what the board asked
 * for: a plot that is no longer a plot must not carry a label a player can click.
 */
export const DISTRICT_SITES: readonly DistrictSite[] = [
  // The tenement stack: storeys of shanty piled round a gabled core with washing strung
  // between them, and still the biggest silhouette in the district.
  site('quarters', [
    [20, 0],
    [26, 1],
    [30, 6],
    [30.5, 14],
    [29, 22],
    [25, 27],
    [19, 28],
    [14, 23],
    [13, 14],
    [15, 5],
  ]),
  // The glass-fronted workshop with `MAKING COOL STUFF` painted over its door: the only lit
  // shopfront in the compound and the only one with a sign.
  // Carried down a little off the glass. Board's nudge: the plate sat on the shopfront's own
  // lettering, and the sign under it reads better than the sign over it.
  site(
    'lab',
    [
      [43, 0],
      [48, 0.5],
      [52, 7],
      [52.5, 13],
      [49, 17],
      [44, 16.5],
      [40, 11],
      [40, 4],
    ],
    { y: 2.4 },
  ),
  // Carried down and well to the left, off the glass and onto the dark walkway beside it. Board's
  // placement, read off an annotated screenshot. The plate used to sit up on the grow lights, which
  // kept it clear of the `WE WANT APPLES!` graffiti but put a dark label over the brightest thing
  // in the district; on the wall below-left it has an unlit ground to sit on and the glass stays
  // whole. The outline is untouched, so the pointer target is still the greenhouse itself.
  site(
    'greenhouse',
    [
      [78, 21],
      [85, 15],
      [93, 19.5],
      [96.5, 26],
      [94, 32.5],
      [85, 34],
      [77.5, 28],
    ],
    // Board's nudge: a little up and right of where it sat, and no further. The ceiling on both
    // is the `WE WANT APPLES!` graffiti above it, which is the one piece of hand-lettering in the
    // district and must not be covered; the plate now sits just under its baseline on the unlit
    // wall, which is as close as it goes.
    { x: -6.2, y: -0.6 },
  ),
  site('apothecary', [
    [44, 29.5],
    [50.5, 28.5],
    [53.5, 34],
    [53, 40.5],
    [48, 43.5],
    [43.5, 41],
    [42.5, 35],
  ]),
  // Carried down and right, off the roof and onto the open ground in front of the doors. Board's
  // placement: the outline's own ground line puts it among the shanty roofs behind it.
  site(
    'gauntlet',
    [
      [22, 33],
      [28, 32],
      [32, 37],
      [33, 43],
      [29, 47],
      [23, 46],
      [19, 41],
      [19, 36],
    ],
    { x: 3, y: 12.7 },
  ),
  site('nexus', [
    [62, 22],
    [67, 23],
    [70.5, 30],
    [71, 40],
    [68, 48],
    [62, 50],
    [59, 42],
    [59, 30],
  ]),
  // The plant on the canal: pipework and a gantry standing over the water.
  site('generator', [
    [85, 38],
    [89, 39],
    [92, 44],
    [92, 50],
    [89, 55],
    [85, 54],
    [83, 48],
    [83, 42],
  ]),
  site('garage', [
    [67, 56],
    [73, 55],
    [77, 59],
    [76, 64],
    [71, 66],
    [66, 64],
    [65, 59],
  ]),
  site('scrapyard', [
    [12, 72],
    [18, 70.5],
    [24, 73],
    [26, 79],
    [24, 85],
    [18, 88],
    [12, 86],
    [10, 79],
  ]),
  // The way in and out, so it is the painted run of palisade the road ends at rather than a lot.
  // The only outline here with four corners, and honestly so: the wall is a straight run of
  // timber seen side-on, so the shape it makes is a parallelogram, and adding vertices to it
  // would be decoration rather than tracing.
  // Slid left onto the gate itself. Board's placement: the outline is wide and its centroid lands
  // out on the boardwalk, which is a plate labelling the planking beside the gate.
  site(
    'gate',
    [
      [37, 70],
      [49, 75],
      [49, 84],
      [37, 79],
    ],
    { x: -7.7, y: 1 },
  ),
  site('infirmary', [
    [82, 72],
    [88, 70],
    [93, 74],
    [94, 82],
    [89, 89],
    [82, 88],
    [79, 80],
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
