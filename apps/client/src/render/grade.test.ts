import { describe, expect, it } from 'vitest';
import {
  GRAIN_BOIL_HZ,
  MAX_SCENE_FILTER_PASSES,
  VIGNETTE_STOPS,
  createPostFx,
  grainSeed,
  postFxPasses,
  vignetteColorStops,
} from './grade';

describe('postFxPasses', () => {
  it('stays inside the ADR 0001 §5.4 four-pass cap on every tier', () => {
    for (const tier of ['low', 'high'] as const) {
      expect(postFxPasses(tier).length).toBeLessThanOrEqual(MAX_SCENE_FILTER_PASSES);
    }
  });

  it('grades before it blooms, and grains last', () => {
    expect(postFxPasses('high')).toEqual(['grade', 'bloom', 'grain']);
  });

  it('drops bloom on the low tier and keeps the grade (ADR §5.5)', () => {
    expect(postFxPasses('low')).toEqual(['grade', 'grain']);
  });
});

describe('grainSeed', () => {
  const stepMs = 1000 / GRAIN_BOIL_HZ;

  it('holds one seed for the whole boil step', () => {
    expect(grainSeed(0)).toBe(grainSeed(stepMs - 1));
    expect(grainSeed(stepMs)).toBe(grainSeed(stepMs * 1.5));
  });

  it('changes on every step boundary', () => {
    expect(grainSeed(stepMs)).not.toBe(grainSeed(0));
    expect(grainSeed(stepMs * 2)).not.toBe(grainSeed(stepMs));
  });

  it('is deterministic and normalised to 0–1', () => {
    for (const ms of [0, 41, 83, 1000, 60_000]) {
      const seed = grainSeed(ms);
      expect(seed).toBe(grainSeed(ms));
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(1);
    }
  });

  it('treats negative elapsed time as the first step rather than producing NaN', () => {
    expect(grainSeed(-500)).toBe(grainSeed(0));
  });
});

describe('createPostFx', () => {
  it('builds one filter per declared pass', () => {
    const chain = createPostFx({ tier: 'high' });
    expect(chain.filters).toHaveLength(postFxPasses('high').length);
    expect(chain.passes).toEqual(postFxPasses('high'));
    chain.destroy();
  });

  it('boils the grain forward over time', () => {
    const chain = createPostFx({ tier: 'low' });
    const noise = chain.filters[chain.passes.indexOf('grain')];
    chain.advance(1000);
    expect(noise).toMatchObject({ seed: grainSeed(1000) });
    chain.destroy();
  });

  it('freezes the boil under a reduced-motion preference (ART-BIBLE §8)', () => {
    const chain = createPostFx({ tier: 'low', reducedMotion: true });
    const noise = chain.filters[chain.passes.indexOf('grain')];
    chain.advance(1000);
    expect(noise).toMatchObject({ seed: grainSeed(0) });
    chain.destroy();
  });
});

describe('vignette falloff', () => {
  it('is clear across the readable middle and darkest at the edge', () => {
    expect(VIGNETTE_STOPS[0]).toEqual({ offset: 0, alpha: 0 });
    expect(VIGNETTE_STOPS.at(-1)?.alpha).toBeGreaterThan(0.5);
  });

  it('carries the falloff in the alpha channel of abyss.950 (ART-BIBLE §2.3)', () => {
    const stops = vignetteColorStops();
    expect(stops.map((stop) => stop.offset)).toEqual(VIGNETTE_STOPS.map((stop) => stop.offset));
    expect(stops[0]?.color).toBe('#05070d00');
    expect(stops.at(-1)?.color).toBe('#05070d9e');
    for (const stop of stops) expect(stop.color).toMatch(/^#05070d[0-9a-f]{2}$/);
  });

  it('rises monotonically outward', () => {
    for (let i = 1; i < VIGNETTE_STOPS.length; i += 1) {
      const previous = VIGNETTE_STOPS[i - 1];
      const current = VIGNETTE_STOPS[i];
      if (!previous || !current) throw new Error('unreachable');
      expect(current.offset).toBeGreaterThan(previous.offset);
      expect(current.alpha).toBeGreaterThanOrEqual(previous.alpha);
    }
  });
});
