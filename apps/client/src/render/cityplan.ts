/**
 * The city seen from above — seeded, pure, resolution-independent geometry.
 *
 * This replaces the skyline for the map. The skyline was an *elevation*: towers standing against a
 * horizon, which is a picture of a city rather than a map of one, and it fought the district markers
 * the whole time — a marker at `y = 0.13` sat in the sky, a marker at `y = 0.9` sat in the
 * foreground rubble, and neither position meant anything about where that district *is*.
 *
 * A plan solves that. Looking down, `y` is distance across the ground, so the layout the districts
 * are arranged in (`CITY_DISTRICTS` — the docks at the bottom, the Spire at the top) is the layout a
 * player sees. It is also the same camera the district screen uses, which is what makes the two
 * screens read as the same world at two zoom levels.
 *
 * The place is Zaun by way of Disco Elysium: no glass towers, no grid. Tar-paper and corrugated
 * roofs packed into irregular blocks, a canal cut through them, and sodium lamps strung along the
 * lanes. Everything is a fraction of the plane it will be painted into, and every draw comes from
 * the asset's own seed, so a plane paints identically on every run and at every viewport size.
 *
 * Colours are whole ART-BIBLE §2.1 ramp stops, never interpolated — depth is expressed by
 * *choosing a darker stop*, not by blending.
 */
import { ramps } from '../theme/tokens';
import { mulberry32, type DepthBand, type Point } from './skyline';

/** A city block: a patch of built-up ground with roofs on it. */
export interface Block {
  /** The block's footprint, clockwise. */
  outline: Point[];
  fill: string;
  roofs: Roof[];
}

/** One building, seen from above. A quad, because nothing here was built with a set square. */
export interface Roof {
  outline: Point[];
  fill: string;
  /** A lit skylight or roof lamp. Absent on most roofs — a lit one has to mean somebody is in. */
  lamp: { x: number; y: number; r: number; warm: boolean } | null;
}

/** The water. One polygon, because it is one cut through the city. */
export interface Canal {
  outline: Point[];
  fill: string;
}

/** A lane between blocks. Drawn as a stroked polyline rather than a filled shape. */
export interface Lane {
  points: Point[];
  width: number;
  fill: string;
}

export interface CityPlan {
  band: DepthBand;
  width: number;
  height: number;
  ground: string | null;
  canal: Canal | null;
  lanes: Lane[];
  blocks: Block[];
}

/**
 * What each parallax band contributes to the plan.
 *
 * The bands are inherited from the elevation renderer and still earn their keep: they are what the
 * map parallaxes on drag. Their *meaning* changes — they are no longer "sky, far, mid, fore" in
 * depth but four passes over the same ground, from the surface up.
 */
interface BandProfile {
  /** Paints the ground itself. Exactly one band does, or the map has no floor. */
  ground: boolean;
  /** Cuts the canal. Exactly one band does. */
  canal: boolean;
  lanes: number;
  /** Blocks across the plane. More blocks means smaller ones. */
  columns: number;
  rows: number;
  /** Roofs per block. */
  roofs: [min: number, max: number];
  /** Share of roofs that carry a lit lamp. */
  litShare: number;
  blockFill: string;
  roofFills: readonly string[];
}

export const BAND_PLANS: Readonly<Record<DepthBand, BandProfile>> = {
  // The floor, and nothing else. Lit street level for everything above to sit on.
  sky: {
    ground: true,
    canal: false,
    lanes: 0,
    columns: 0,
    rows: 0,
    roofs: [0, 0],
    litShare: 0,
    blockFill: ramps.abyss[700],
    roofFills: [],
  },
  // The bulk of the city. Dense on purpose: the first pass used seven columns across the frame and
  // drew 150px roofs, which read as grey slabs rather than as a city. A block has to be small
  // enough that a player sees *texture* at a glance and buildings only when they look.
  far: {
    ground: false,
    canal: false,
    lanes: 9,
    columns: 18,
    rows: 11,
    roofs: [5, 9],
    litShare: 0.16,
    blockFill: ramps.abyss[700],
    roofFills: [ramps.ferrite[950], ramps.abyss[500], ramps.smog[950]],
  },
  mid: {
    ground: false,
    canal: false,
    lanes: 6,
    columns: 13,
    rows: 8,
    roofs: [4, 8],
    litShare: 0.24,
    blockFill: ramps.abyss[500],
    roofFills: [ramps.ferrite[700], ramps.smog[700], ramps.abyss[300]],
  },
  /**
   * Nearest — and the band that carries the water and the arterial roads.
   *
   * Those two belong to the *ground*, so the obvious place for them was the bottom band. It was
   * wrong: the eighteen-column block layer above buried both, and the map lost the one feature that
   * tells a player which side of the city they are on. Drawn last they cut through the blocks,
   * which is what a canal and a six-lane road actually do to a city.
   */
  fore: {
    ground: false,
    canal: true,
    lanes: 5,
    columns: 8,
    rows: 5,
    roofs: [3, 6],
    litShare: 0.34,
    blockFill: ramps.abyss[300],
    roofFills: [ramps.ferrite[500], ramps.smog[500], ramps.ferrite[700]],
  },
};

/** Sodium indoors, hextech signage. Both additive when painted, so the bloom pass finds them. */
export const LAMP_FILLS = { warm: ramps.ember[300], cold: ramps.hextech[300] } as const;

/**
 * The ground is **lighter than the buildings on it**, which is the opposite of the elevation view
 * and the right way round for a plan.
 *
 * From above at night a city is lit streets between dark roofs — the light is *in* the gaps. Drawn
 * the other way (pale blocks on black ground, which is what the first pass did) the lanes disappear
 * and the whole map reads as scattered slabs with nothing joining them.
 */
export const GROUND_FILL = ramps.smog[700];
/** Water is the darkest thing on the map: a black ribbon that takes a bite out of the street grid. */
export const CANAL_FILL = ramps.abyss[700];
/** Lit tarmac — brighter than the ground so an arterial road reads through the blocks. */
export const LANE_FILL = ramps.smog[500];

/** `min + rng() * (max - min)`, the shape every dimension below is drawn with. */
function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * A quad with every corner nudged — the shape of a roof nobody measured.
 *
 * Rectangles are the giveaway in a procedural city: a plan full of them reads as a spreadsheet seen
 * from above. Jitter is a fraction of the quad's own size, so a big roof leans as much as a small
 * one and nothing collapses at either end of the scale.
 */
function jitteredQuad(
  x: number,
  y: number,
  w: number,
  h: number,
  jitter: number,
  rng: () => number,
): Point[] {
  const jx = w * jitter;
  const jy = h * jitter;
  const at = (px: number, py: number): Point => ({
    x: px + between(rng, -jx, jx),
    y: py + between(rng, -jy, jy),
  });
  return [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)];
}

/**
 * The canal, cut corner to corner.
 *
 * One continuous cut rather than a branching river: it is the map's strongest read, the thing that
 * tells a player at a glance which side of the city they are on, and a delta would make it scenery
 * instead. It runs top-right to bottom-left because that is the diagonal the district layout leaves
 * clearest — see `CITY_DISTRICTS`.
 */
function cutCanal(width: number, height: number, rng: () => number): Canal {
  const steps = 7;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    // A slack curve from the top-right to the bottom-left, wandering as it goes.
    const x = width * (0.86 - 0.78 * t) + between(rng, -width * 0.03, width * 0.03);
    const y = height * t;
    const half = width * between(rng, 0.018, 0.032);
    top.push({ x: x - half, y });
    bottom.push({ x: x + half, y });
  }
  return { outline: [...top, ...bottom.reverse()], fill: CANAL_FILL };
}

/** The lanes between blocks: long, nearly-straight runs that wander a little. */
function layLanes(count: number, width: number, height: number, rng: () => number): Lane[] {
  const lanes: Lane[] = [];
  for (let i = 0; i < count; i += 1) {
    const horizontal = rng() < 0.55;
    const points: Point[] = [];
    const steps = 5;
    const offset = between(rng, 0.08, 0.92);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const drift = between(rng, -0.035, 0.035);
      points.push(
        horizontal
          ? { x: width * t, y: height * (offset + drift) }
          : { x: width * (offset + drift), y: height * t },
      );
    }
    lanes.push({ points, width: Math.max(2, width * between(rng, 0.004, 0.009)), fill: LANE_FILL });
  }
  return lanes;
}

/** Roofs packed into a block, each a leaning quad, a few of them lit. */
function fillBlock(outline: Point[], profile: BandProfile, rng: () => number): Roof[] {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const w = right - left;
  const h = bottom - top;

  const count = Math.round(between(rng, profile.roofs[0], profile.roofs[1]));
  const roofs: Roof[] = [];
  for (let i = 0; i < count; i += 1) {
    // Inset so a roof never straddles the lane its block is bounded by.
    const rw = w * between(rng, 0.18, 0.38);
    const rh = h * between(rng, 0.2, 0.42);
    const rx = left + between(rng, 0.06, 0.94 - rw / w) * w;
    const ry = top + between(rng, 0.06, 0.94 - rh / h) * h;
    const fill =
      profile.roofFills[Math.floor(rng() * profile.roofFills.length)] ?? ramps.abyss[300];
    const lit = rng() < profile.litShare;
    roofs.push({
      outline: jitteredQuad(rx, ry, rw, rh, 0.12, rng),
      fill,
      lamp: lit
        ? {
            x: rx + rw * between(rng, 0.3, 0.7),
            y: ry + rh * between(rng, 0.3, 0.7),
            r: Math.max(1, Math.min(rw, rh) * between(rng, 0.08, 0.16)),
            warm: rng() < 0.72,
          }
        : null,
    });
  }
  return roofs;
}

/**
 * The blocks, laid on an irregular grid.
 *
 * A grid is the skeleton — cities do have streets — but every cell is inset by a random margin, so
 * what a player sees is blocks of different sizes with lanes of different widths between them
 * rather than a chessboard. `columns`/`rows` are per band, which is what makes the near bands read
 * as fewer, bigger roofs.
 */
function layBlocks(
  profile: BandProfile,
  width: number,
  height: number,
  rng: () => number,
): Block[] {
  const blocks: Block[] = [];
  const cw = width / profile.columns;
  const ch = height / profile.rows;
  for (let col = 0; col < profile.columns; col += 1) {
    for (let row = 0; row < profile.rows; row += 1) {
      // A few gaps: a city with no empty lots is a city nobody has lived in.
      if (rng() < 0.12) continue;
      const inset = between(rng, 0.06, 0.18);
      const x = cw * (col + inset);
      const y = ch * (row + inset);
      const w = cw * (1 - inset * 2);
      const h = ch * (1 - inset * 2);
      const outline = jitteredQuad(x, y, w, h, 0.05, rng);
      blocks.push({ outline, fill: profile.blockFill, roofs: fillBlock(outline, profile, rng) });
    }
  }
  return blocks;
}

/** The whole plan for one band. Pure: same seed and size in, same geometry out. */
export function generateCityPlan(
  band: DepthBand,
  width: number,
  height: number,
  seed: number,
): CityPlan {
  const profile = BAND_PLANS[band];
  const rng = mulberry32(seed);
  return {
    band,
    width,
    height,
    ground: profile.ground ? GROUND_FILL : null,
    canal: profile.canal ? cutCanal(width, height, rng) : null,
    lanes: layLanes(profile.lanes, width, height, rng),
    blocks: layBlocks(profile, width, height, rng),
  };
}
