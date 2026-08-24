import { describe, expect, it } from 'vitest';
import { CITY_DISTRICTS } from '../city/index.js';
import { OVERSEER_PRESETS } from '../overseer.js';
import { ART_MANIFEST, type AssetSpec } from './manifest.js';
import {
  CHATGPT_BASELINE_SIZES,
  HERO_ASSETS,
  HERO_ASSET_KEYS,
  isChatGptBaselineSize,
  isHeroAsset,
} from './hero.js';

describe('the hero set', () => {
  /**
   * The number the board is given as a single instruction ("do these fourteen"). It is derived, so
   * this pins the derivation: adding a district must move it, and adding an alpha asset must not.
   */
  it('is exactly the 4 overseer portraits and the 10 district illustrations', () => {
    expect(HERO_ASSETS).toHaveLength(OVERSEER_PRESETS.length + CITY_DISTRICTS.length);
    expect(HERO_ASSET_KEYS).toEqual([
      ...OVERSEER_PRESETS.map((preset) => `portrait-${preset.portraitId}`),
      ...CITY_DISTRICTS.map((district) => `district-${district.id}`),
    ]);
  });

  it('holds only portraits and districts, in manifest order', () => {
    expect([...new Set(HERO_ASSETS.map((spec) => spec.class))]).toEqual(['portrait', 'district']);
    expect(HERO_ASSET_KEYS).toEqual(ART_MANIFEST.filter(isHeroAsset).map((spec) => spec.key));
  });

  it('asks for nothing but a plain download: no alpha, no post-process, a baseline size', () => {
    for (const spec of HERO_ASSETS) {
      expect({ key: spec.key, alpha: spec.alpha, postProcess: spec.postProcess }).toEqual({
        key: spec.key,
        alpha: false,
        postProcess: [],
      });
      expect(isChatGptBaselineSize(spec.source), spec.key).toBe(true);
      // The master is the delivery image: nothing stands between the download and the game.
      expect([spec.source.width, spec.source.height]).toEqual([spec.width, spec.height]);
    }
  });

  it('excludes every asset that needs transparency, a post-process or a 16:9 canvas', () => {
    const excluded = ART_MANIFEST.filter((spec) => !isHeroAsset(spec));
    expect(excluded).toHaveLength(ART_MANIFEST.length - HERO_ASSETS.length);
    for (const spec of excluded) {
      const blocked =
        spec.alpha || spec.postProcess.length > 0 || !isChatGptBaselineSize(spec.source);
      expect(blocked, spec.key).toBe(true);
    }
  });

  it('rejects a hero asset the moment it grows an alpha channel or a post-process', () => {
    const hero: AssetSpec = HERO_ASSETS[0]!;
    expect(isHeroAsset({ ...hero, alpha: true })).toBe(false);
    expect(isHeroAsset({ ...hero, postProcess: ['downscale'] })).toBe(false);
    expect(isHeroAsset({ ...hero, source: { ...hero.source, width: 2048 } })).toBe(false);
  });
});

describe('CHATGPT_BASELINE_SIZES', () => {
  it('is the three sizes OpenAI documents for gpt-image-1', () => {
    expect(CHATGPT_BASELINE_SIZES).toEqual([
      [1024, 1024],
      [1024, 1536],
      [1536, 1024],
    ]);
  });

  it('rejects a 16:9 canvas: no ChatGPT baseline size is 16:9', () => {
    expect(isChatGptBaselineSize({ width: 2048, height: 1152, alpha: false })).toBe(false);
  });
});
