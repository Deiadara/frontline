/**
 * The whole-scene post-FX chain: ADR 0001 §5.4 and ART-BIBLE §3.3/§8.
 *
 * Built as a composable unit and returned, never mounted here; wiring it onto the scene root is
 * phase 2. Named filter imports only: `pixi-filters`' barrel pulls all 40+ shaders into the bundle.
 */
import { AdjustmentFilter } from 'pixi-filters/adjustment';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { ColorMapFilter } from 'pixi-filters/color-map';
import { FillGradient, Graphics, NoiseFilter, type Filter, type Texture } from 'pixi.js';
import { ramps } from '../theme/tokens';

/** ADR §5.4: filters each cost a render-target ping-pong. Measure before adding a fifth. */
export const MAX_SCENE_FILTER_PASSES = 4;

/** ART-BIBLE §8: grain boils at 12 Hz, matching hand-drawn animation, not at frame rate. */
export const GRAIN_BOIL_HZ = 12;

/** ADR §5.5: `low` drops bloom on GPUs that cannot hold 60 fps with it. */
export type PostFxTier = 'low' | 'high';

export type PostFxPass = 'grade' | 'bloom' | 'grain';

/**
 * The passes that run, in order. Pure, so the ADR §5.4 pass cap is a unit test rather than a
 * code review. Vignette is deliberately absent: it is a multiply-blended `Graphics` plane
 * ({@link createVignette}), not a filter, and so costs no pass.
 */
export function postFxPasses(tier: PostFxTier): readonly PostFxPass[] {
  return tier === 'low' ? ['grade', 'grain'] : ['grade', 'bloom', 'grain'];
}

/**
 * Deterministic 0-1 grain seed for the boil step covering `elapsedMs`. Holding one seed for the
 * whole 1/12 s step is what makes the grain read as paint rather than as video noise.
 */
export function grainSeed(elapsedMs: number): number {
  const step = Math.floor((Math.max(elapsedMs, 0) * GRAIN_BOIL_HZ) / 1000);
  const noise = Math.sin(step * 12.9898 + 78.233) * 43758.5453;
  return noise - Math.floor(noise);
}

export interface PostFxOptions {
  tier: PostFxTier;
  /**
   * The `lut-frontline-grade` texture once it exists. Until then the grade falls back to a
   * contrast/saturation push, which is why the chain works with zero art on disk.
   */
  lut?: Texture | undefined;
  /** ART-BIBLE §8: reduced motion keeps the static grade and stops the boil. */
  reducedMotion?: boolean | undefined;
}

export interface PostFxChain {
  /** Assign to the scene root's `filters`. Order matches {@link postFxPasses}. */
  readonly filters: readonly Filter[];
  readonly passes: readonly PostFxPass[];
  /** Advance the grain boil. `elapsedMs` is time since the chain was created, not a delta. */
  advance(elapsedMs: number): void;
  destroy(): void;
}

/** ART-BIBLE §3.3: only emissives bloom, so the threshold sits well above the structural mids. */
const BLOOM_THRESHOLD = 0.62;

function gradeFilter(lut: Texture | undefined): Filter {
  if (lut) return new ColorMapFilter({ colorMap: lut, nearest: false });
  // Cold-key/warm-bounce separation without a LUT: pull saturation down, push contrast up.
  return new AdjustmentFilter({ saturation: 0.88, contrast: 1.12, gamma: 1.04, brightness: 0.98 });
}

function bloomFilter(): Filter {
  // ADR §5.4: half resolution (`pixelSize: 2`) is visually identical at our scale and ~4× cheaper.
  return new AdvancedBloomFilter({
    threshold: BLOOM_THRESHOLD,
    bloomScale: 1.1,
    brightness: 1,
    blur: 6,
    quality: 4,
    pixelSize: { x: 2, y: 2 },
  });
}

export function createPostFx(options: PostFxOptions): PostFxChain {
  const passes = postFxPasses(options.tier);
  if (passes.length > MAX_SCENE_FILTER_PASSES) {
    throw new Error(
      `Post-FX chain is ${passes.length} whole-scene passes; ADR 0001 §5.4 caps it at ${MAX_SCENE_FILTER_PASSES}`,
    );
  }

  const noise = new NoiseFilter({ noise: 0.09, seed: grainSeed(0) });
  const byPass: Record<PostFxPass, () => Filter> = {
    grade: () => gradeFilter(options.lut),
    bloom: bloomFilter,
    grain: () => noise,
  };
  const filters = passes.map((pass) => byPass[pass]());

  let seed = noise.seed;
  return {
    filters,
    passes,
    advance(elapsedMs) {
      if (options.reducedMotion) return;
      const next = grainSeed(elapsedMs);
      if (next === seed) return;
      seed = next;
      noise.seed = next;
    },
    destroy() {
      for (const filter of filters) filter.destroy();
    },
  };
}

/**
 * Vignette falloff, centre → corner. ART-BIBLE §2.3: it darkens toward `abyss.950`, the deepest
 * legal black, and stays fully clear across the middle so nothing readable is dimmed.
 */
export const VIGNETTE_STOPS = [
  { offset: 0, alpha: 0 },
  { offset: 0.55, alpha: 0 },
  { offset: 0.82, alpha: 0.3 },
  { offset: 1, alpha: 0.62 },
] as const;

/** `#rrggbbaa` stops: `FillGradient` carries the falloff in the alpha channel. */
export function vignetteColorStops(): { offset: number; color: string }[] {
  return VIGNETTE_STOPS.map((stop) => ({
    offset: stop.offset,
    color: `${ramps.abyss[950]}${Math.round(stop.alpha * 255)
      .toString(16)
      .padStart(2, '0')}`,
  }));
}

/**
 * The vignette plane. ADR §4.1: a multiply-blended radial `Graphics`, not a filter. It costs no
 * render-target pass, which is what keeps the chain inside the §5.4 budget. Sits on the `grade`
 * plane, so it is sized to the screen rather than to the map.
 *
 * `FillGradient` bakes its ramp through a 2D canvas, so this needs a real browser: jsdom cannot
 * construct it. The falloff data and its stop colours are unit-tested; the plane itself is
 * verified in Chromium.
 */
export function createVignette(width: number, height: number): Graphics {
  const gradient = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    textureSpace: 'local',
    colorStops: vignetteColorStops(),
  });
  const g = new Graphics();
  g.label = 'vignette';
  g.blendMode = 'multiply';
  // A full-screen `Graphics` is hit-testable by default, and this one sits above everything, so
  // without this it silently swallows every click on the map underneath it.
  g.eventMode = 'none';
  g.rect(0, 0, width, height).fill(gradient);
  return g;
}
