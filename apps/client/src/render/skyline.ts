/**
 * Seeded city-mass geometry: the interim painted look promised by ADR 0001 §5.3.
 *
 * Pure and resolution-independent: every dimension is a fraction of the plane it will be painted
 * into, and every random draw comes from the asset's own `seed`, so a key paints identically on
 * every run and at every viewport size. `procedural.ts` turns this into PixiJS objects; keeping the
 * geometry here means the silhouette rules are unit-tested rather than eyeballed.
 *
 * Colours are picked as whole ART-BIBLE §2.1 ramp stops, never interpolated: §2.1 forbids
 * inventing intermediate hues, so depth is expressed by *choosing a darker stop*, not by blending.
 */
import { ramps } from '../theme/tokens';

/** Which parallax plane a mass belongs to: ADR §5.2 rows `sky`, `far`, `mid` and `fore`. */
export type DepthBand = 'sky' | 'far' | 'mid' | 'fore';

export interface Point {
  x: number;
  y: number;
}

/** A lit window. Unlit windows are not emitted. They are just façade. */
export interface WindowCell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sodium interior (`ember`) vs. cold display glow (`hextech`): ART-BIBLE §3.3. */
  warm: boolean;
}

export interface Tower {
  /** Closed stepped silhouette, y-down, in plane pixels. Painted as one filled polygon. */
  outline: Point[];
  windows: WindowCell[];
  /** `0` furthest back in the band → `1` nearest. Selects the fill stop. */
  depth: number;
  fill: string;
  /**
   * Gutted masses: sheared roof, no aerial, near-dark façade. GDD §A2 asks for old, destroyed and
   * new side by side, and a skyline of uniformly healthy buildings is what reads as "futuristic
   * city at night" instead of "post-war undercity". This is the flag that keeps both in frame.
   */
  derelict: boolean;
}

/**
 * A gantry, catwalk or slung cable bridge tying two masses together: ART-BIBLE §5, "scrap is
 * structure" and "break the box". Kept apart from {@link Tower} because a strut is the one piece
 * of city geometry that is *not* grounded, so it must not be held to the tower invariants.
 */
export interface Strut {
  /** Closed quad, y-down, in plane pixels. */
  outline: Point[];
  fill: string;
}

export interface Skyline {
  band: DepthBand;
  width: number;
  height: number;
  towers: Tower[];
  struts: Strut[];
}

/**
 * mulberry32: 32-bit, seedable, no dependency. Quality is irrelevant here; determinism is the
 * whole point, so that `plane-city-far` has the same skyline in a screenshot test as in the app.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BandProfile {
  towers: number;
  /** Tower width as a fraction of plane width. */
  width: [number, number];
  /** Tower height as a fraction of plane height. */
  height: [number, number];
  /** Chance a tower stacks a third accreted storey instead of just two. */
  stackChance: number;
  /** Chance a standing tower carries a mast above its top segment. Derelicts never do: it fell. */
  spireChance: number;
  /**
   * How far this band's accretion may wander outside its ground storey's own footprint, as a
   * fraction of that footprint's width. It bounds every horizontal excursion at once: overhanging
   * storeys, lean, and the scrap sheds at the foot.
   *
   * `fore` is deliberately near-zero, but be precise about what that buys. {@link BandProfile.spans}
   * bounds tower *centres*, not extents, so a `fore` mass already reaches into the middle of the
   * plate by up to half its own width; near-zero `sprawl` only stops it leaning any further in.
   * What keeps the middle readable is that `fore` is kept *low*, so its masses sit below the
   * districts rather than over them. The one hard horizontal guarantee is on gantries, which
   * {@link strutsBetween} refuses to string across a gap between two spans.
   */
  sprawl: number;
  /** Chance any one façade cell on a *powered* storey is lit. */
  windowChance: number;
  /**
   * Lit-window size as a fraction of *plane* height. Sizing windows off the tower instead makes a
   * wide foreground tower sprout 40px light-boxes: the flat-rectangle failure mode. A storey is a
   * fixed real-world size, so it scales with the plane and only grows a little as bands come nearer.
   */
  windowScale: number;
  /**
   * Fractions of plane width the band's masses are laid across. Every band but `fore` spans the
   * full plate; `fore` is split into two outer margins so the readable middle stays open.
   */
  spans: readonly (readonly [number, number])[];
  /**
   * Fill stops for the band, furthest → nearest. Distant bands sit on `smog` (haze-desaturated
   * architecture); near bands sit on `abyss` (near-black occluders that frame the readable middle).
   */
  fills: readonly string[];
}

const FULL_SPAN = [[0, 1]] as const;

/**
 * ART-BIBLE §5: silhouette reads first, and it reads by *value*: each band forward is a step
 * darker than the one behind it (`smog` → `abyss.300` → `abyss.500` → `abyss.950`), which is what
 * atmospheric perspective is. Bands all painted from the same near-black end read as one flat
 * black field no matter how good the geometry is.
 *
 * `fore` is deliberately low and edge-bound. It sits *above* the interactive plane, so anything
 * tall and wide there is not an occluder but a curtain over the districts the player must click.
 */
export const BAND_PROFILES: Record<DepthBand, BandProfile> = {
  sky: {
    towers: 26,
    // Taller than every band in front of it: bands are all floor-anchored, so a distant band
    // that is not the tallest is simply painted over and contributes nothing.
    width: [0.018, 0.055],
    height: [0.46, 0.9],
    stackChance: 0.55,
    spireChance: 0.45,
    sprawl: 0.3,
    windowChance: 0.2,
    windowScale: 0.0026,
    spans: FULL_SPAN,
    fills: [ramps.smog[700], ramps.smog[950], ramps.abyss[300]],
  },
  far: {
    towers: 16,
    width: [0.05, 0.11],
    height: [0.32, 0.66],
    stackChance: 0.45,
    spireChance: 0.28,
    sprawl: 0.32,
    windowChance: 0.34,
    windowScale: 0.0034,
    spans: FULL_SPAN,
    fills: [ramps.smog[950], ramps.abyss[300], ramps.abyss[500]],
  },
  mid: {
    towers: 12,
    width: [0.06, 0.14],
    height: [0.16, 0.4],
    stackChance: 0.4,
    spireChance: 0.2,
    sprawl: 0.34,
    windowChance: 0.3,
    windowScale: 0.0042,
    spans: FULL_SPAN,
    fills: [ramps.abyss[500], ramps.abyss[700]],
  },
  fore: {
    towers: 8,
    // Low enough to clear the lowest district (y = 0.88) and its tag; masts are thin, so they
    // read as foreground antennae without hiding anything clickable behind them.
    width: [0.06, 0.16],
    height: [0.03, 0.075],
    stackChance: 0.3,
    spireChance: 0.5,
    sprawl: 0.05,
    windowChance: 0.12,
    windowScale: 0.006,
    spans: [
      [0, 0.34],
      [0.66, 1],
    ],
    fills: [ramps.abyss[950]],
  },
};

export const WINDOW_WARM_CHANCE = 0.72;

/**
 * Share of masses that are gutted rather than standing (GDD §A2: "old, destroyed, and new ones
 * side by side"). Kept a minority: past half, the skyline stops reading as a city that lost a war
 * and starts reading as an abandoned one.
 */
export const DERELICT_CHANCE = 0.34;

/**
 * Chance a storey has power at all, before any individual cell is rolled. ART-BIBLE §5: "the
 * lights are half out": an undercity is unevenly powered, so lit windows come in clumped bands
 * with dark floors between them. Rolling only per-cell gives a uniform sprinkle, which at skyline
 * scale is exactly the regular curtain-wall grid A2 rejects.
 */
const FLOOR_POWERED_CHANCE = { standing: 0.45, derelict: 0.08 } as const;

/**
 * Roof shear as a signed fraction of the top storey's height: one side of the roof sits that much
 * lower than the other. ART-BIBLE §5, "no intact roof lines": a flat horizontal top edge is the
 * chrome-futurism tell, so every mass ends where it broke.
 */
const ROOF_SHEAR = { standing: [0.12, 0.4], derelict: [0.4, 0.85] } as const;

/**
 * Width of an accreted storey relative to the one below it. The range straddles 1.0 on purpose: a
 * planned tower only ever tapers, and a skyline of pure tapers reads as a zoning code this city
 * never had. Above 1.0 the storey overhangs the one below (ART-BIBLE §5).
 */
const STOREY_WIDTH_RATIO = [0.55, 1.32] as const;

/** Chance a mass has a scrap lean-to piled against its foot: ART-BIBLE §5, "scrap is structure". */
const LEAN_TO_CHANCE = 0.5;

/** Chance two close-enough neighbours are tied together by a gantry. */
const GANTRY_CHANCE = 0.45;

/** Widest gap a gantry may span, as a fraction of plane width. Wider than this, nobody bridged it. */
const MAX_GANTRY_SPAN = 0.05;

/**
 * One storey of a tower, bottom → top. Unlike a planned tower's setbacks, a storey here may be
 * *wider* than the one below and sit off its centre: that overhang is the accretion read.
 */
interface Segment {
  width: number;
  height: number;
  /** Centre offset from the tower's own centre. Non-zero storeys lean off true. */
  dx: number;
  /** Signed roof shear; only the topmost storey carries one. See {@link ROOF_SHEAR}. */
  shear: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** A signed draw from a magnitude range, e.g. `±[0.4, 0.85]`. */
const signed = (range: readonly [number, number], rng: () => number): number =>
  lerp(range[0], range[1], rng()) * (rng() < 0.5 ? -1 : 1);

/** Picks the ramp stop for `depth`, clamped: no interpolation (ART-BIBLE §2.1). */
export function fillForDepth(fills: readonly string[], depth: number): string {
  const index = Math.min(fills.length - 1, Math.max(0, Math.floor(depth * fills.length)));
  return fills[index] as string;
}

/**
 * Stacks one accreted storey on `below`.
 *
 * Two bounds keep the jury-rigging from becoming a bug:
 *
 * - **Consecutive storeys must overlap in x.** `outlineFor` walks one wall up and the other back
 *   down, so two storeys that do not overlap put the left connector to the right of the right one
 *   and the polygon self-intersects. `|Δdx| < (w_below + w) / 2` is exactly the overlap condition;
 *   it is taken at 40% for margin.
 * - **The stack stays within `sprawl` of the ground storey's footprint** (`reach`), so a band with
 *   a layout contract, `fore`, cannot lean its way into the middle of the plate.
 */
function accretedOnto(
  below: Segment,
  width: number,
  height: number,
  reach: number,
  rng: () => number,
): Segment {
  const half = Math.min(width, 2 * reach) / 2;
  const step = 0.4 * (below.width + half * 2) * 0.5;
  const dx = clamp(below.dx + (rng() * 2 - 1) * step, -(reach - half), reach - half);
  return { width: half * 2, height, dx, shear: 0 };
}

function segmentsFor(
  profile: BandProfile,
  width: number,
  height: number,
  derelict: boolean,
  rng: () => number,
): Segment[] {
  const reach = width * (0.5 + profile.sprawl);
  const ratio = () => lerp(STOREY_WIDTH_RATIO[0], STOREY_WIDTH_RATIO[1], rng());
  const stack = (segments: Segment[], storeyHeight: number) => {
    const below = segments[segments.length - 1]!;
    segments.push(accretedOnto(below, below.width * ratio(), storeyHeight, reach, rng));
  };

  const segments: Segment[] = [{ width, height: height * lerp(0.55, 0.8, rng()), dx: 0, shear: 0 }];
  const remaining = height - segments[0]!.height;
  if (rng() < profile.stackChance) {
    stack(segments, remaining * 0.65);
    stack(segments, remaining * 0.35);
  } else {
    stack(segments, remaining);
  }

  // A derelict has already lost its aerial; a standing mass may still carry one, leaning off the
  // storey below it like everything else here.
  if (!derelict && rng() < profile.spireChance) {
    const top = segments[segments.length - 1]!;
    segments.push(
      accretedOnto(top, Math.max(1, top.width * 0.12), height * lerp(0.08, 0.2, rng()), reach, rng),
    );
  }

  const top = segments[segments.length - 1]!;
  top.shear = top.height * signed(ROOF_SHEAR[derelict ? 'derelict' : 'standing'], rng);
  return segments;
}

/**
 * Walks the stepped profile up the left side and back down the right, so the accreted storeys, the
 * mast and the sheared roof come out as one closed polygon the painter can fill in a single call.
 */
function outlineFor(segments: readonly Segment[], centreX: number, baseY: number): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  let y = baseY;
  for (const segment of segments) {
    const centre = centreX + segment.dx;
    const half = segment.width / 2;
    left.push({ x: centre - half, y });
    right.push({ x: centre + half, y });
    y -= segment.height;
    // The roof drops on one side only, so the top edge is a slant, not a level line.
    left.push({ x: centre - half, y: y + Math.max(0, segment.shear) });
    right.push({ x: centre + half, y: y + Math.max(0, -segment.shear) });
  }
  return [...left, ...right.reverse()];
}

/**
 * Façade grid for one segment. Only lit cells survive, so a dark tower costs nothing to draw.
 *
 * Power is rolled per *storey* before any cell is, so the façade comes out in lit bands separated
 * by dark ones rather than as an even sprinkle across a lattice. Column positions carry a jitter
 * for the same reason: what makes a curtain wall read as one is the regularity, not the count.
 */
function windowsFor(
  segment: Segment,
  centreX: number,
  top: number,
  profile: BandProfile,
  planeHeight: number,
  poweredChance: number,
  rng: () => number,
): WindowCell[] {
  const cell = Math.max(1.5, planeHeight * profile.windowScale);
  const gap = cell * 1.1;
  // The roof shear cuts into the top storey, so the façade starts below the deepest part of the
  // cut: otherwise a lit window floats in the sky above a broken roof line.
  const facadeTop = top + Math.abs(segment.shear);
  const facadeHeight = segment.height - Math.abs(segment.shear);
  const columns = Math.floor((segment.width - gap) / (cell + gap));
  const rows = Math.floor((facadeHeight - gap) / (cell + gap));
  if (columns < 1 || rows < 1) return [];

  const centre = centreX + segment.dx;
  const originX = centre - ((columns - 1) * (cell + gap)) / 2 - cell / 2;
  const cells: WindowCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    if (rng() >= poweredChance) continue;
    for (let column = 0; column < columns; column += 1) {
      if (rng() >= profile.windowChance) continue;
      cells.push({
        x: originX + column * (cell + gap) + (rng() - 0.5) * gap * 0.8,
        y: facadeTop + gap + row * (cell + gap),
        w: cell,
        h: cell * 1.35,
        warm: rng() < WINDOW_WARM_CHANCE,
      });
    }
  }
  return cells;
}

function towerAt(
  centreX: number,
  depth: number,
  profile: BandProfile,
  width: number,
  height: number,
  rng: () => number,
): Tower {
  // Nearer towers in a band are taller and wider: the cue that sells depth inside one plane.
  const towerWidth = width * lerp(profile.width[0], profile.width[1], lerp(rng(), depth, 0.5));
  const towerHeight = height * lerp(profile.height[0], profile.height[1], lerp(rng(), depth, 0.5));
  const derelict = rng() < DERELICT_CHANCE;
  const segments = segmentsFor(profile, towerWidth, towerHeight, derelict, rng);
  const powered = FLOOR_POWERED_CHANCE[derelict ? 'derelict' : 'standing'];

  const windows: WindowCell[] = [];
  let top = height;
  for (const segment of segments) {
    top -= segment.height;
    windows.push(...windowsFor(segment, centreX, top, profile, height, powered, rng));
  }

  return {
    outline: outlineFor(segments, centreX, height),
    windows,
    depth,
    fill: fillForDepth(profile.fills, depth),
    derelict,
  };
}

/**
 * Horizontal extent of a mass, in the two forms its callers need.
 *
 * `left`/`right` span the *whole* outline: what a gantry hangs off, since it attaches somewhere
 * up the wall rather than at the floor. `base` spans only the ground storey, where the mass meets
 * the floor. Storeys may overhang (see {@link STOREY_WIDTH_RATIO}), so the two genuinely differ:
 * anything anchored to the ground-floor wall, a lean-to, must use `base` or it is planted out in
 * open air under the overhang, with a gap between it and the mass it is supposed to be leaning on.
 */
function footprintOf(tower: Tower): {
  left: number;
  right: number;
  top: number;
  base: { left: number; right: number };
} {
  const xs = tower.outline.map((point) => point.x);
  const ys = tower.outline.map((point) => point.y);
  // `outlineFor` emits the ground storey's two corners at exactly `baseY` and every later point
  // strictly above it (no segment has zero height), so this is an exact match, not a tolerance.
  const baseY = Math.max(...ys);
  const baseXs = tower.outline.filter((point) => point.y === baseY).map((point) => point.x);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    base: { left: Math.min(...baseXs), right: Math.max(...baseXs) },
  };
}

/**
 * A scrap shed piled against the foot of a mass: ART-BIBLE §5, "scrap is structure". Its roof
 * slopes away from the wall it leans on, which is what distinguishes it from just another tower.
 *
 * Emitted as a {@link Tower} rather than a special case: it is grounded, closed and filled from the
 * same ramp stop, so it satisfies every invariant the masses already do and the painter is unchanged.
 */
function leanToAgainst(
  parent: Tower,
  profile: BandProfile,
  baseY: number,
  rng: () => number,
): Tower {
  const { base, top } = footprintOf(parent);
  const outward = rng() < 0.5 ? -1 : 1;
  // The *ground-floor* wall, not the widest point of the silhouette: an overhanging upper storey
  // is not something you can pile scrap against.
  const wallX = outward < 0 ? base.left : base.right;
  // Sized off `sprawl` for the same reason the storeys are: it is the single bound on how far a
  // mass may spread sideways, and `fore` must not spread at all. Measured against *this* parent's
  // footprint rather than the band's average width, so the excursion a shed adds is bounded by
  // `sprawl` for every parent instead of only for an average-width one.
  const width = (base.right - base.left) * profile.sprawl * lerp(0.7, 1, rng());
  const height = (baseY - top) * lerp(0.12, 0.3, rng());

  // Built from the same stacked-storey vocabulary as a mass, so it satisfies the silhouette
  // invariants rather than needing an exemption: a wide bit on the ground and a narrower one set
  // back against the wall, roofed by a shear that falls *away* from the wall. That fall is what
  // reads as a lean-to instead of a small tower.
  const upperWidth = width * lerp(0.5, 0.8, rng());
  const upperHeight = height * 0.4;
  const segments: Segment[] = [
    { width, height: height - upperHeight, dx: 0, shear: 0 },
    {
      width: upperWidth,
      height: upperHeight,
      dx: -outward * ((width - upperWidth) / 2),
      shear: -outward * upperHeight * lerp(0.5, 0.9, rng()),
    },
  ];

  return {
    outline: outlineFor(segments, wallX + (outward * width) / 2, baseY),
    windows: [],
    depth: parent.depth,
    fill: parent.fill,
    derelict: parent.derelict,
  };
}

/**
 * Ties neighbouring masses together with gantries. Only genuinely adjacent pairs qualify: a strut
 * across a wide gap is not a catwalk, and on `fore` it would be a bar drawn straight over the
 * clickable middle of the plate, whose two margins are exactly such a gap.
 */
function strutsBetween(
  towers: readonly Tower[],
  profile: BandProfile,
  planeWidth: number,
  baseY: number,
  rng: () => number,
): Strut[] {
  const struts: Strut[] = [];
  const ordered = [...towers].sort((a, b) => footprintOf(a).left - footprintOf(b).left);
  const thickness = Math.max(2, baseY * 0.005);
  // A gap *between* two spans is there on purpose: on `fore` it is the clickable middle of the
  // plate. Bounding the span length alone does not protect it: masses jitter and sprawl toward the
  // boundary, so two of them can close to within a bridgeable distance across it. Requiring the
  // whole gap to sit inside a single span encodes the layout contract instead of relying on the
  // draw. Full-span bands are unaffected.
  const spannable = (from: number, to: number) =>
    profile.spans.some(([a, b]) => from >= a * planeWidth && to <= b * planeWidth);

  for (let index = 1; index < ordered.length; index += 1) {
    const near = footprintOf(ordered[index - 1]!);
    const far = footprintOf(ordered[index]!);
    const gap = far.left - near.right;
    if (rng() >= GANTRY_CHANCE) continue;
    if (gap <= thickness || gap > planeWidth * MAX_GANTRY_SPAN) continue;
    if (!spannable(near.right, far.left)) continue;

    // Slung below the shorter of the two roofs, so it always has something to hang off at both
    // ends. Clamped clear of the floor: the shorter mass may be a knee-high scrap shed, and a
    // gantry hung off that would otherwise cross the horizon line it is supposed to sit above.
    const lowestRoof = Math.max(near.top, far.top);
    const y = Math.min(lerp(baseY, lowestRoof, lerp(0.35, 0.85, rng())), baseY - thickness);
    if (y <= lowestRoof) continue;
    struts.push({
      outline: [
        { x: near.right, y },
        { x: far.left, y },
        { x: far.left, y: y + thickness },
        { x: near.right, y: y + thickness },
      ],
      // The nearer mass's stop, so the bridge never reads lighter than what it is attached to.
      fill: (ordered[index - 1]!.depth > ordered[index]!.depth
        ? ordered[index - 1]
        : ordered[index])!.fill,
    });
  }
  return struts;
}

/**
 * Tower centres, laid on a jittered even spacing inside each of the band's spans. The band's
 * tower budget is shared out in proportion to how much of the plate each span covers, so a band
 * confined to two narrow margins gets a sensible density rather than the full-plate count crammed
 * into a third of the width.
 */
function centresFor(profile: BandProfile, width: number, rng: () => number): number[] {
  const covered = profile.spans.reduce((sum, [from, to]) => sum + (to - from), 0);
  const centres: number[] = [];
  for (const [from, to] of profile.spans) {
    const count = Math.max(1, Math.round((profile.towers * (to - from)) / covered));
    const step = ((to - from) * width) / count;
    for (let index = 0; index < count; index += 1) {
      centres.push(from * width + step * (index + 0.5) + (rng() - 0.5) * step * 0.8);
    }
  }
  return centres;
}

/**
 * Builds one band's silhouette. Towers are sorted back to front, so nearer (darker) masses overlap
 * the hazed ones behind them.
 */
export function generateSkyline(
  band: DepthBand,
  width: number,
  height: number,
  seed: number,
): Skyline {
  const profile = BAND_PROFILES[band];
  const rng = mulberry32(seed);

  const masses: Tower[] = [];
  for (const centreX of centresFor(profile, width, rng)) {
    const tower = towerAt(centreX, rng(), profile, width, height, rng);
    masses.push(tower);
    // A shed carries its parent's depth, so the stable sort below leaves it painted directly on
    // top of the mass it leans against rather than behind some unrelated neighbour.
    if (rng() < LEAN_TO_CHANCE) {
      masses.push(leanToAgainst(tower, profile, height, rng));
    }
  }

  const towers = masses.sort((a, b) => a.depth - b.depth);
  // Gantries are strung last, so they can tie sheds and masses alike and are painted over both.
  return {
    band,
    width,
    height,
    towers,
    struts: strutsBetween(towers, profile, width, height, rng),
  };
}

/** Window emissive colours: ART-BIBLE §3.3, warm sodium interiors against the cold key. */
export const WINDOW_FILLS = { warm: ramps.ember[300], cold: ramps.hextech[300] } as const;
