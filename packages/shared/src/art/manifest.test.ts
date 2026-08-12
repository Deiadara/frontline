import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from '../building.js';
import { CITY_DISTRICTS, DISTRICT_KINDS } from '../city.js';
import { OVERSEER_ARCHETYPES, OVERSEER_PRESETS } from '../overseer.js';
import { ResourcesSchema } from '../resources.js';
import {
  ART_MANIFEST,
  ASSET_CLASS_SPECS,
  AssetSpecSchema,
  backendCanProduce,
  backendsForSource,
  findAssetSpec,
  parseAssetFileName,
  postProcessFor,
  resolveAssetKey,
  STYLE_REFERENCE_KEYS,
  subjectResolvesToDomainId,
  validateAssetSpec,
  type AssetSource,
  type AssetSpec,
} from './manifest.js';
import { NEGATIVE, STYLE_ANCHOR } from './prompts.js';

/**
 * Transcribed from `docs/ART-PROMPTS.md` §1–§6. The manifest derives these from the domain
 * constants; this table is the independent copy that catches a derivation going wrong.
 */
const EXPECTED: readonly (readonly [key: string, file: string, seed: number])[] = [
  ['portrait-overseer-1', 'portrait-overseer-1.webp', 110001],
  ['portrait-overseer-2', 'portrait-overseer-2.webp', 110002],
  ['portrait-overseer-3', 'portrait-overseer-3.webp', 110003],
  ['portrait-overseer-4', 'portrait-overseer-4.webp', 110004],
  ['district-neon-docks', 'district-neon-docks.webp', 120001],
  ['district-ashen-terraces', 'district-ashen-terraces.webp', 120002],
  ['district-rustyard', 'district-rustyard.webp', 120003],
  ['district-chrome-row', 'district-chrome-row.webp', 120004],
  ['district-undergrid', 'district-undergrid.webp', 120005],
  ['district-datavault-sigma', 'district-datavault-sigma.webp', 120006],
  ['district-glasshouse-fields', 'district-glasshouse-fields.webp', 120007],
  ['district-sprawl-exchange', 'district-sprawl-exchange.webp', 120008],
  ['district-halcyon-plaza', 'district-halcyon-plaza.webp', 120009],
  ['district-blacksite-7', 'district-blacksite-7.webp', 120010],
  ['district-combine-spire', 'district-combine-spire.webp', 120011],
  ['plate-city', 'plate-city.webp', 130001],
  ['plane-city-sky', 'plane-city-sky.webp', 130002],
  ['plane-city-far', 'plane-city-far.webp', 130003],
  ['plane-city-fore', 'plane-city-fore.webp', 130004],
  ['splash-auth', 'splash-auth.webp', 130005],
  ['building-command-center', 'building-command-center.webp', 140001],
  ['building-reactor', 'building-reactor.webp', 140002],
  ['building-data-hub', 'building-data-hub.webp', 140003],
  ['building-foundry', 'building-foundry.webp', 140004],
  ['building-barracks', 'building-barracks.webp', 140005],
  ['building-wall', 'building-wall.webp', 140006],
  ['ui-frame-panel', 'ui-frame-panel.png', 150001],
  ['ui-frame-modal', 'ui-frame-modal.png', 150002],
  ['ui-frame-hud', 'ui-frame-hud.png', 150003],
  ['ui-plate-button', 'ui-plate-button.png', 150004],
  ['ui-plate-nav', 'ui-plate-nav.png', 150005],
  ['ui-divider', 'ui-divider.png', 150006],
  ['icon-credits', 'icon-credits.webp', 160001],
  ['icon-power', 'icon-power.webp', 160002],
  ['icon-data', 'icon-data.webp', 160003],
  ['icon-alloy', 'icon-alloy.webp', 160004],
  ['icon-archetype-enforcer', 'icon-archetype-enforcer.webp', 160011],
  ['icon-archetype-netrunner', 'icon-archetype-netrunner.webp', 160012],
  ['icon-archetype-fixer', 'icon-archetype-fixer.webp', 160013],
  ['icon-archetype-technocrat', 'icon-archetype-technocrat.webp', 160014],
  ['icon-kind-player-base', 'icon-kind-player-base.webp', 160021],
  ['icon-kind-raid', 'icon-kind-raid.webp', 160022],
  ['icon-kind-market', 'icon-kind-market.webp', 160023],
  ['icon-kind-npc-stronghold', 'icon-kind-npc-stronghold.webp', 160024],
];

const districtSpec = (): AssetSpec => {
  const spec = findAssetSpec('district-neon-docks');
  if (!spec) throw new Error('district-neon-docks is missing from the manifest');
  return spec;
};

describe('ART_MANIFEST', () => {
  it('matches the ART-PROMPTS asset list exactly, in order', () => {
    expect(ART_MANIFEST.map((spec) => [spec.key, spec.file, spec.seed])).toEqual(
      EXPECTED.map((row) => [...row]),
    );
  });

  it('holds the 44 MVP assets', () => {
    expect(ART_MANIFEST).toHaveLength(44);
  });

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec] as const))(
    '%s parses its schema',
    (_, spec) => {
      expect(() => AssetSpecSchema.parse(spec)).not.toThrow();
    },
  );

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec] as const))(
    '%s satisfies the ART-BIBLE rules',
    (_, spec) => {
      expect(validateAssetSpec(spec)).toEqual([]);
    },
  );

  it('has unique keys, filenames and seeds', () => {
    const keys = ART_MANIFEST.map((spec) => spec.key);
    const files = ART_MANIFEST.map((spec) => spec.file);
    const seeds = ART_MANIFEST.map((spec) => spec.seed);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(files).size).toBe(files.length);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('matches the ART-BIBLE §6 resolution and aspect table per class', () => {
    for (const spec of ART_MANIFEST) {
      const classSpec = ASSET_CLASS_SPECS[spec.class];
      expect({ width: spec.width, height: spec.height, aspect: spec.aspect }).toEqual({
        width: classSpec.width,
        height: classSpec.height,
        aspect: classSpec.aspect,
      });
    }
  });

  it('carries the ART-BIBLE §6 delivery format and quality per class', () => {
    // Hand-transcribed from the §6 table; PNG classes are lossless and carry no quality.
    expect(
      Object.fromEntries(
        Object.entries(ASSET_CLASS_SPECS).map(([name, s]) => [name, `${s.ext}${s.quality ?? ''}`]),
      ),
    ).toEqual({
      portrait: 'webp90',
      district: 'webp90',
      plate: 'webp92',
      plane: 'webp90',
      building: 'webp90',
      ui: 'png',
      icon: 'webp88',
      splash: 'webp90',
      lut: 'png',
    });
  });

  it('marks the sky plane opaque and the other planes alpha', () => {
    expect(findAssetSpec('plane-city-sky')?.alpha).toBe(false);
    expect(findAssetSpec('plane-city-far')?.alpha).toBe(true);
    expect(findAssetSpec('plane-city-fore')?.alpha).toBe(true);
  });

  it('gives every asset the two reference images except those generated before them', () => {
    const unreferenced = ART_MANIFEST.filter((spec) => spec.styleRefs.length === 0).map(
      (s) => s.key,
    );
    expect(unreferenced).toEqual([
      'portrait-overseer-1',
      'district-neon-docks',
      'plate-city',
      'plane-city-sky',
      'plane-city-far',
      'plane-city-fore',
    ]);
    for (const spec of ART_MANIFEST) {
      if (spec.styleRefs.length > 0) expect(spec.styleRefs).toEqual([...STYLE_REFERENCE_KEYS]);
    }
  });

  it('routes the overseer portraits to gpt-image-1 per ADR 0001 §6.6', () => {
    for (const spec of ART_MANIFEST.filter((s) => s.class === 'portrait')) {
      expect(spec.backend).toBe('openai');
    }
  });

  /** The acceptance criterion of MOU-123: no manifest entry may be unbuildable. */
  it('gives every asset at least one backend that can render its source', () => {
    for (const spec of ART_MANIFEST) {
      expect(backendsForSource(spec.source), spec.key).not.toEqual([]);
    }
  });

  it('pins a backend exactly when only one can render the asset, and never a wrong one', () => {
    for (const spec of ART_MANIFEST) {
      const capable = backendsForSource(spec.source);
      if (spec.backend === undefined) {
        expect(capable.length, spec.key).toBeGreaterThan(1);
      } else {
        expect(capable, spec.key).toContain(spec.backend);
        // Portraits are pinned for quality (ADR 0001 §6.6); everything else for capability.
        if (capable.length > 1) expect(spec.class).toBe('portrait');
      }
    }
  });

  it('renders icons at 1024² and downscales — nothing produces 512² with alpha', () => {
    for (const spec of ART_MANIFEST.filter((s) => s.class === 'icon')) {
      expect(spec, spec.key).toMatchObject({
        width: 512,
        height: 512,
        alpha: true,
        source: { width: 1024, height: 1024, alpha: true },
        postProcess: ['downscale'],
        backend: 'openai',
      });
    }
  });

  it('renders the alpha planes opaque and mattes them — nothing produces 16:9 with alpha', () => {
    for (const key of ['plane-city-far', 'plane-city-fore']) {
      expect(findAssetSpec(key), key).toMatchObject({
        alpha: true,
        source: { width: 2048, height: 1152, alpha: false },
        postProcess: ['matte'],
        backend: 'fal',
      });
    }
    // The sky plane already ships opaque, so its master is the delivery image.
    expect(findAssetSpec('plane-city-sky')).toMatchObject({ postProcess: [] });
  });

  it('leaves the other 30 assets needing no post-process at all', () => {
    expect(ART_MANIFEST.filter((spec) => spec.postProcess.length > 0)).toHaveLength(14);
  });

  it('carries the shared prompt blocks as single-line prose', () => {
    for (const text of [STYLE_ANCHOR, NEGATIVE]) {
      expect(text).not.toMatch(/\s{2,}|\n/);
    }
    expect(STYLE_ANCHOR).toContain('#22d3ee');
    expect(NEGATIVE).toContain('cel shading');
  });
});

describe('file naming grammar (ART-BIBLE §7)', () => {
  it.each(ART_MANIFEST.map((spec) => spec.file))('%s parses and is lower-kebab', (file) => {
    expect(parseAssetFileName(file)).not.toBeNull();
    expect(file).toBe(file.toLowerCase());
    expect(file).not.toMatch(/[\s_]/);
  });

  it.each([
    'District-Neon-Docks.webp',
    'district neon docks.webp',
    'district-neon-docks-v2.webp',
    'district-neon-docks-final.webp',
    'district_neon_docks.webp',
    'neon-docks.webp',
    'sprite-neon-docks.webp',
    'district-neon-docks.jpg',
  ])('rejects "%s"', (file) => {
    expect(parseAssetFileName(file)).toBeNull();
  });

  it('accepts variants and @2x', () => {
    expect(parseAssetFileName('building-reactor-damaged.webp')).toMatchObject({
      class: 'building',
      subject: 'reactor',
      variant: 'damaged',
      retina: false,
    });
    expect(parseAssetFileName('portrait-overseer-1@2x.webp')).toMatchObject({
      subject: 'overseer-1',
      retina: true,
    });
  });
});

describe('subject resolution (ART-BIBLE §7)', () => {
  it('resolves every portrait subject to a preset portraitId', () => {
    const portraitIds = OVERSEER_PRESETS.map((preset) => preset.portraitId);
    for (const id of portraitIds) expect(subjectResolvesToDomainId('portrait', id)).toBe(true);
    expect(subjectResolvesToDomainId('portrait', 'overseer-9')).toBe(false);
  });

  it('resolves every district subject to a District.id', () => {
    for (const district of CITY_DISTRICTS) {
      expect(subjectResolvesToDomainId('district', district.id)).toBe(true);
    }
    expect(subjectResolvesToDomainId('district', 'nowhere')).toBe(false);
  });

  it('resolves every building subject to a BuildingKind', () => {
    for (const kind of BUILDING_KINDS) {
      expect(subjectResolvesToDomainId('building', kind.replaceAll('_', '-'))).toBe(true);
    }
    expect(subjectResolvesToDomainId('building', 'sky-hook')).toBe(false);
  });

  it('resolves resource, archetype and district-kind icon subjects', () => {
    for (const resource of Object.keys(ResourcesSchema.shape)) {
      expect(subjectResolvesToDomainId('icon', resource)).toBe(true);
    }
    for (const archetype of OVERSEER_ARCHETYPES) {
      expect(subjectResolvesToDomainId('icon', `archetype-${archetype}`)).toBe(true);
    }
    for (const kind of DISTRICT_KINDS) {
      expect(subjectResolvesToDomainId('icon', `kind-${kind.replaceAll('_', '-')}`)).toBe(true);
    }
    expect(subjectResolvesToDomainId('icon', 'scrap')).toBe(false);
    expect(subjectResolvesToDomainId('icon', 'archetype-samurai')).toBe(false);
    expect(subjectResolvesToDomainId('icon', 'kind-wasteland')).toBe(false);
  });

  it('does not constrain classes with no domain counterpart', () => {
    expect(subjectResolvesToDomainId('ui', 'frame-panel')).toBe(true);
    expect(subjectResolvesToDomainId('plane', 'city-sky')).toBe(true);
  });
});

describe('validateAssetSpec', () => {
  it('rejects a subject that resolves to no domain id', () => {
    const broken: AssetSpec = {
      ...districtSpec(),
      key: 'district-nowhere',
      file: 'district-nowhere.webp',
    };
    expect(validateAssetSpec(broken)).toContainEqual(
      expect.stringContaining('resolves to no district id'),
    );
  });

  it('rejects a resolution that contradicts the ART-BIBLE §6 table', () => {
    expect(validateAssetSpec({ ...districtSpec(), width: 800, height: 600 })).toContainEqual(
      expect.stringContaining('ART-BIBLE §6 requires 1024×1024'),
    );
  });

  it('rejects a filename that disagrees with the key', () => {
    expect(validateAssetSpec({ ...districtSpec(), file: 'district-rustyard.webp' })).toContainEqual(
      expect.stringContaining('does not match key'),
    );
  });

  it('rejects an unknown style reference', () => {
    expect(
      validateAssetSpec({ ...districtSpec(), styleRefs: ['district-atlantis'] }),
    ).toContainEqual(expect.stringContaining('unknown style ref'));
  });

  const withSource = (source: AssetSource, extra: Partial<AssetSpec> = {}): AssetSpec => ({
    ...districtSpec(),
    source,
    postProcess: postProcessFor(source, { width: 1024, height: 1024, alpha: false }),
    ...extra,
  });

  it('rejects a source smaller than the delivery — upscaling invents detail', () => {
    expect(validateAssetSpec(withSource({ width: 512, height: 512, alpha: false }))).toContainEqual(
      expect.stringContaining('smaller than its 1024×1024 delivery'),
    );
  });

  it('rejects a source that changes the aspect', () => {
    expect(
      validateAssetSpec(withSource({ width: 2048, height: 1152, alpha: false })),
    ).toContainEqual(expect.stringContaining('a different aspect'));
  });

  it('rejects a source carrying alpha the delivery throws away', () => {
    expect(
      validateAssetSpec(withSource({ width: 1024, height: 1024, alpha: true })),
    ).toContainEqual(expect.stringContaining('renders with alpha but ships opaque'));
  });

  it('rejects a declared post-process the source does not imply', () => {
    const spec = withSource(
      { width: 1024, height: 1024, alpha: false },
      { postProcess: ['matte'] },
    );
    expect(validateAssetSpec(spec)).toContainEqual(
      expect.stringContaining('declares postProcess [matte], its source implies []'),
    );
  });

  it('rejects an asset no backend can render — the MOU-123 failure mode', () => {
    // 512×512 with alpha: below gpt-image-1's minimum, and fal has no alpha channel.
    const spec = withSource({ width: 512, height: 512, alpha: true });
    expect(validateAssetSpec(spec)).toContainEqual(
      expect.stringContaining('has no producible backend path'),
    );
  });

  it('rejects a pin to a backend that cannot render the source', () => {
    const spec = withSource({ width: 1024, height: 1024, alpha: false }, { backend: 'openai' });
    expect(
      validateAssetSpec({ ...spec, source: { width: 2048, height: 1152, alpha: false } }),
    ).toContainEqual(expect.stringContaining('is pinned to "openai", which cannot render'));
  });
});

describe('backend capabilities (ADR 0001 §6.1)', () => {
  it('knows fal takes any size but no alpha', () => {
    expect(backendCanProduce('fal', { width: 2048, height: 1152, alpha: false })).toBe(true);
    expect(backendCanProduce('fal', { width: 512, height: 512, alpha: false })).toBe(true);
    expect(backendCanProduce('fal', { width: 1024, height: 1024, alpha: true })).toBe(false);
  });

  it('knows gpt-image-1 takes alpha but only three sizes', () => {
    expect(backendCanProduce('openai', { width: 1024, height: 1024, alpha: true })).toBe(true);
    expect(backendCanProduce('openai', { width: 1024, height: 1536, alpha: false })).toBe(true);
    expect(backendCanProduce('openai', { width: 2048, height: 1152, alpha: false })).toBe(false);
    expect(backendCanProduce('openai', { width: 512, height: 512, alpha: true })).toBe(false);
  });

  it('reports the empty set for a source neither backend can render', () => {
    expect(backendsForSource({ width: 512, height: 512, alpha: true })).toEqual([]);
    expect(backendsForSource({ width: 1024, height: 1024, alpha: false })).toEqual([
      'fal',
      'openai',
    ]);
  });
});

describe('postProcessFor', () => {
  it('derives the steps from the gap between source and delivery', () => {
    const delivery = { width: 512, height: 512, alpha: true };
    expect(postProcessFor({ width: 512, height: 512, alpha: true }, delivery)).toEqual([]);
    expect(postProcessFor({ width: 1024, height: 1024, alpha: true }, delivery)).toEqual([
      'downscale',
    ]);
    // Matte at master resolution, then downscale — the other order fringes the alpha edge.
    expect(postProcessFor({ width: 1024, height: 1024, alpha: false }, delivery)).toEqual([
      'matte',
      'downscale',
    ]);
  });
});

describe('resolveAssetKey', () => {
  it('builds keys for every domain id in the manifest', () => {
    expect(resolveAssetKey({ type: 'district', districtId: 'neon-docks' })).toBe(
      'district-neon-docks',
    );
    expect(resolveAssetKey({ type: 'building', building: 'command_center' })).toBe(
      'building-command-center',
    );
    expect(resolveAssetKey({ type: 'portrait', portraitId: 'overseer-2' })).toBe(
      'portrait-overseer-2',
    );
    expect(resolveAssetKey({ type: 'resource-icon', resource: 'alloy' })).toBe('icon-alloy');
    expect(resolveAssetKey({ type: 'archetype-icon', archetype: 'fixer' })).toBe(
      'icon-archetype-fixer',
    );
    expect(resolveAssetKey({ type: 'district-kind-icon', districtKind: 'npc_stronghold' })).toBe(
      'icon-kind-npc-stronghold',
    );
  });

  it('throws rather than returning a key with no manifest entry', () => {
    expect(() => resolveAssetKey({ type: 'district', districtId: 'nowhere' })).toThrow(
      /No manifest entry/,
    );
  });
});
