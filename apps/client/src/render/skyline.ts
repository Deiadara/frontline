/**
 * Seeded city-mass geometry — the interim painted look promised by ADR 0001 §5.3.
 *
 * Pure and resolution-independent: every dimension is a fraction of the plane it will be painted
 * into, and every random draw comes from the asset's own `seed`, so a key paints identically on
 * every run and at every viewport size. `procedural.ts` turns this into PixiJS objects; keeping the
 * geometry here means the silhouette rules are unit-tested rather than eyeballed.
 *
 * Colours are picked as whole ART-BIBLE §2.1 ramp stops, never interpolated — §2.1 forbids
 * inventing intermediate hues, so depth is expressed by *choosing a darker stop*, not by blending.
 */
import { ramps } from '../theme/tokens';

/** Which parallax plane a mass belongs to — ADR §5.2 rows `sky`, `far` and `fore`. */
export type DepthBand = 'sky' | 'far' | 'fore';

export interface Point {
  x: number;
  y: number;
}

/** A lit window. Unlit windows are not emitted — they are just façade. */
export interface WindowCell {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sodium interior (`ember`) vs. cold display glow (`hextech`) — ART-BIBLE §3.3. */
  warm: boolean;
}

export interface Tower {
  /** Closed stepped silhouette, y-down, in plane pixels. Painted as one filled polygon. */
  outline: Point[];
  windows: WindowCell[];
  /** `0` furthest back in the band → `1` nearest. Selects the fill stop. */
  depth: number;
  fill: string;
}

export interface Skyline {
  band: DepthBand;
  width: number;
  height: number;
  towers: Tower[];
}

/**
 * mulberry32 — 32-bit, seedable, no dependency. Quality is irrelevant here; determinism is the
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
  /** Chance a tower steps in near the top instead of ending flat. */
  setbackChance: number;
  /** Chance a tower carries a mast above its top segment. */
  spireChance: number;
  /** Chance any one façade cell is lit. */
  windowChance: number;
  /**
   * Fill stops for the band, furthest → nearest. Distant bands sit on `smog` (haze-desaturated
   * architecture); near bands sit on `abyss` (near-black occluders that frame the readable middle).
   */
  fills: readonly string[];
}

/**
 * ART-BIBLE §5 — silhouette reads first. Distant bands are many, thin and low-contrast; the
 * foreground is few, wide and near-black, so the interactive middle plane stays the bright subject.
 */
const BAND_PROFILES: Record<DepthBand, BandProfile> = {
  sky: {
    towers: 26,
    width: [0.018, 0.055],
    height: [0.3, 0.72],
    setbackChance: 0.55,
    spireChance: 0.45,
    windowChance: 0.08,
    fills: [ramps.smog[700], ramps.smog[950], ramps.abyss[100]],
  },
  far: {
    towers: 18,
    width: [0.05, 0.12],
    height: [0.35, 0.8],
    setbackChance: 0.45,
    spireChance: 0.28,
    windowChance: 0.32,
    fills: [ramps.abyss[300], ramps.abyss[500], ramps.ferrite[950]],
  },
  fore: {
    towers: 7,
    width: [0.1, 0.22],
    height: [0.45, 0.95],
    setbackChance: 0.3,
    spireChance: 0.12,
    windowChance: 0.05,
    fills: [ramps.abyss[700], ramps.abyss[950]],
  },
};

export const WINDOW_WARM_CHANCE = 0.72;

/** One storey of a tower, bottom → top. Each is centred on the tower and no wider than the one below. */
interface Segment {
  width: number;
  height: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Picks the ramp stop for `depth`, clamped — no interpolation (ART-BIBLE §2.1). */
export function fillForDepth(fills: readonly string[], depth: number): string {
  const index = Math.min(fills.length - 1, Math.max(0, Math.floor(depth * fills.length)));
  return fills[index] as string;
}

function segmentsFor(profile: BandProfile, width: number, height: number, rng: () => number) {
  const segments: Segment[] = [{ width, height: height * lerp(0.55, 0.8, rng()) }];
  if (rng() < profile.setbackChance) {
    const remaining = height - segments[0]!.height;
    segments.push({ width: width * lerp(0.55, 0.8, rng()), height: remaining * 0.65 });
    segments.push({ width: width * lerp(0.3, 0.5, rng()), height: remaining * 0.35 });
  } else {
    segments.push({ width, height: height - segments[0]!.height });
  }
  if (rng() < profile.spireChance) {
    const top = segments[segments.length - 1]!;
    segments.push({
      width: Math.max(1, top.width * 0.12),
      height: height * lerp(0.08, 0.2, rng()),
    });
  }
  return segments;
}

/**
 * Walks the stepped profile up the left side and back down the right, so setbacks and the mast
 * come out as one closed polygon the painter can fill in a single call.
 */
function outlineFor(segments: readonly Segment[], centreX: number, baseY: number): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  let y = baseY;
  for (const segment of segments) {
    const half = segment.width / 2;
    left.push({ x: centreX - half, y });
    right.push({ x: centreX + half, y });
    y -= segment.height;
    left.push({ x: centreX - half, y });
    right.push({ x: centreX + half, y });
  }
  return [...left, ...right.reverse()];
}

/** Façade grid for one segment. Only lit cells survive, so a dark tower costs nothing to draw. */
function windowsFor(
  segment: Segment,
  centreX: number,
  top: number,
  profile: BandProfile,
  rng: () => number,
): WindowCell[] {
  const cell = Math.max(2, segment.width * 0.16);
  const gap = cell * 0.6;
  const columns = Math.floor((segment.width - gap) / (cell + gap));
  const rows = Math.floor((segment.height - gap) / (cell + gap));
  if (columns < 1 || rows < 1) return [];

  const originX = centreX - ((columns - 1) * (cell + gap)) / 2 - cell / 2;
  const cells: WindowCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (rng() >= profile.windowChance) continue;
      cells.push({
        x: originX + column * (cell + gap),
        y: top + gap + row * (cell + gap),
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
  // Nearer towers in a band are taller and wider — the cue that sells depth inside one plane.
  const towerWidth = width * lerp(profile.width[0], profile.width[1], lerp(rng(), depth, 0.5));
  const towerHeight = height * lerp(profile.height[0], profile.height[1], lerp(rng(), depth, 0.5));
  const segments = segmentsFor(profile, towerWidth, towerHeight, rng);

  const windows: WindowCell[] = [];
  let top = height;
  for (const segment of segments) {
    top -= segment.height;
    windows.push(...windowsFor(segment, centreX, top, profile, rng));
  }

  return {
    outline: outlineFor(segments, centreX, height),
    windows,
    depth,
    fill: fillForDepth(profile.fills, depth),
  };
}

/**
 * Builds one band's silhouette. Towers are laid on a jittered even spacing and sorted back to
 * front, so nearer (darker) masses overlap the hazed ones behind them.
 */
export function generateSkyline(
  band: DepthBand,
  width: number,
  height: number,
  seed: number,
): Skyline {
  const profile = BAND_PROFILES[band];
  const rng = mulberry32(seed);
  const step = width / profile.towers;

  const towers = Array.from({ length: profile.towers }, (_, index) => {
    const centreX = step * (index + 0.5) + (rng() - 0.5) * step * 0.8;
    return towerAt(centreX, rng(), profile, width, height, rng);
  }).sort((a, b) => a.depth - b.depth);

  return { band, width, height, towers };
}

/** Window emissive colours — ART-BIBLE §3.3, warm sodium interiors against the cold key. */
export const WINDOW_FILLS = { warm: ramps.ember[300], cold: ramps.hextech[300] } as const;
