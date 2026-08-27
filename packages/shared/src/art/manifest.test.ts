import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from '../building/index.js';
import { CITY_DISTRICTS, DISTRICT_KINDS } from '../city/index.js';
import { OVERSEER_ARCHETYPES, OVERSEER_PRESETS } from '../overseer.js';
import { RESOURCE_KEYS } from '../resources.js';
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
  tryResolveAssetKey,
  validateAssetSpec,
  type AssetSource,
  type AssetSpec,
} from './manifest.js';
import { FRAMING, NEGATIVE, PLATE_SUBJECTS, STYLE_ANCHOR } from './prompts.js';

/**
 * Transcribed from `docs/ART-PROMPTS.md` §1-§6. The manifest derives these from the domain
 * constants; this table is the independent copy that catches a derivation going wrong.
 */
const EXPECTED: readonly (readonly [key: string, file: string, seed: number])[] = [
  ['portrait-overseer-1', 'portrait-overseer-1.webp', 110001],
  ['portrait-overseer-2', 'portrait-overseer-2.webp', 110002],
  ['portrait-overseer-3', 'portrait-overseer-3.webp', 110003],
  ['portrait-overseer-4', 'portrait-overseer-4.webp', 110004],
  ['district-neon-docks', 'district-neon-docks.webp', 120001],
  ['district-ashen-terraces', 'district-ashen-terraces.webp', 120002],
  ['district-kettle-row', 'district-kettle-row.webp', 120003],
  ['district-rustyard', 'district-rustyard.webp', 120004],
  ['district-chrome-row', 'district-chrome-row.webp', 120005],
  ['district-undergrid', 'district-undergrid.webp', 120006],
  ['district-datavault-sigma', 'district-datavault-sigma.webp', 120007],
  ['district-glasshouse-fields', 'district-glasshouse-fields.webp', 120008],
  ['district-blacksite-7', 'district-blacksite-7.webp', 120009],
  ['district-combine-spire', 'district-combine-spire.webp', 120010],
  ['plate-city', 'plate-city.webp', 130001],
  ['plane-city-sky', 'plane-city-sky.webp', 130002],
  ['plane-city-far', 'plane-city-far.webp', 130003],
  ['plane-city-fore', 'plane-city-fore.webp', 130004],
  ['splash-auth', 'splash-auth.webp', 130005],
  ['plate-district', 'plate-district.webp', 130006],
  ['building-nexus', 'building-nexus.webp', 140001],
  ['building-quarters', 'building-quarters.webp', 140002],
  ['building-greenhouse', 'building-greenhouse.webp', 140003],
  ['building-generator', 'building-generator.webp', 140004],
  ['building-scrapyard', 'building-scrapyard.webp', 140005],
  ['building-cistern', 'building-cistern.webp', 140006],
  ['building-apothecary', 'building-apothecary.webp', 140007],
  ['building-gate', 'building-gate.webp', 140008],
  ['building-lab', 'building-lab.webp', 140009],
  ['building-gauntlet', 'building-gauntlet.webp', 140010],
  ['building-infirmary', 'building-infirmary.webp', 140011],
  ['building-garage', 'building-garage.webp', 140012],
  ['unit-razors', 'unit-razors.webp', 145001],
  ['unit-anodics', 'unit-anodics.webp', 145002],
  ['unit-sparks', 'unit-sparks.webp', 145003],
  ['unit-scrapers', 'unit-scrapers.webp', 145004],
  ['unit-muckrakers', 'unit-muckrakers.webp', 145005],
  ['unit-breakers', 'unit-breakers.webp', 145006],
  ['unit-wardens', 'unit-wardens.webp', 145007],
  ['unit-ghosts', 'unit-ghosts.webp', 145008],
  ['unit-road-reavers', 'unit-road-reavers.webp', 145009],
  ['unit-ironsides', 'unit-ironsides.webp', 145010],
  ['unit-ash-walkers', 'unit-ash-walkers.webp', 145011],
  ['unit-snipers', 'unit-snipers.webp', 145012],
  ['unit-stitchers', 'unit-stitchers.webp', 145013],
  ['unit-demolishers', 'unit-demolishers.webp', 145014],
  ['unit-jammers', 'unit-jammers.webp', 145015],
  ['unit-kite-crews', 'unit-kite-crews.webp', 145016],
  ['unit-netrunners', 'unit-netrunners.webp', 145017],
  ['unit-sleepers', 'unit-sleepers.webp', 145018],
  ['unit-cyber-dogs', 'unit-cyber-dogs.webp', 145019],
  ['unit-bell-ringers', 'unit-bell-ringers.webp', 145020],
  ['unit-wrecking-crew', 'unit-wrecking-crew.webp', 145021],
  ['unit-juggernauts', 'unit-juggernauts.webp', 145022],
  ['unit-hollow-men', 'unit-hollow-men.webp', 145023],
  ['unit-the-condemned', 'unit-the-condemned.webp', 145024],
  ['unit-the-specter', 'unit-the-specter.webp', 145025],
  ['unit-the-abomination', 'unit-the-abomination.webp', 145026],
  ['unit-the-colossus', 'unit-the-colossus.webp', 145027],
  ['unit-the-saint', 'unit-the-saint.webp', 145028],
  ['unit-the-cartographer', 'unit-the-cartographer.webp', 145029],
  ['unit-the-twins', 'unit-the-twins.webp', 145030],
  // The support tier is last in the catalogue on purpose: a unit inserted anywhere else
  // renumbers every seed after it. See the note at the head of `UNIT_CATALOG`.
  ['unit-scavengers', 'unit-scavengers.webp', 145031],
  ['unit-haulers', 'unit-haulers.webp', 145032],
  ['ui-frame-panel', 'ui-frame-panel.png', 150001],
  ['ui-frame-modal', 'ui-frame-modal.png', 150002],
  ['ui-frame-hud', 'ui-frame-hud.png', 150003],
  ['ui-plate-button', 'ui-plate-button.png', 150004],
  ['ui-plate-nav', 'ui-plate-nav.png', 150005],
  ['ui-divider', 'ui-divider.png', 150006],
  ['icon-caps', 'icon-caps.webp', 160001],
  ['icon-supplies', 'icon-supplies.webp', 160002],
  ['icon-oil', 'icon-oil.webp', 160003],
  ['icon-scrap', 'icon-scrap.webp', 160004],
  ['icon-high-quality-metal', 'icon-high-quality-metal.webp', 160005],
  ['icon-planks', 'icon-planks.webp', 160006],
  ['icon-archetype-enforcer', 'icon-archetype-enforcer.webp', 160011],
  ['icon-archetype-netrunner', 'icon-archetype-netrunner.webp', 160012],
  ['icon-archetype-fixer', 'icon-archetype-fixer.webp', 160013],
  ['icon-archetype-technocrat', 'icon-archetype-technocrat.webp', 160014],
  ['icon-kind-residential', 'icon-kind-residential.webp', 160021],
  ['icon-kind-contested', 'icon-kind-contested.webp', 160022],
  ['icon-location-scrap-press', 'icon-location-scrap-press.webp', 160031],
  ['icon-location-chemical-plant', 'icon-location-chemical-plant.webp', 160032],
  ['icon-location-power-station', 'icon-location-power-station.webp', 160033],
  ['icon-location-water-works', 'icon-location-water-works.webp', 160034],
  ['icon-location-foundry', 'icon-location-foundry.webp', 160035],
  ['icon-location-gas-station', 'icon-location-gas-station.webp', 160036],
  ['icon-location-nuclear-plant', 'icon-location-nuclear-plant.webp', 160037],
  ['icon-location-soup-kitchen', 'icon-location-soup-kitchen.webp', 160038],
  ['icon-location-refugee-camp', 'icon-location-refugee-camp.webp', 160039],
  ['icon-location-market', 'icon-location-market.webp', 160040],
  ['icon-location-downtown-market', 'icon-location-downtown-market.webp', 160041],
  ['icon-location-pawn-shop', 'icon-location-pawn-shop.webp', 160042],
  ['icon-location-bone-market', 'icon-location-bone-market.webp', 160043],
  ['icon-location-revolutionist-statue', 'icon-location-revolutionist-statue.webp', 160044],
  ['icon-location-high-ground', 'icon-location-high-ground.webp', 160045],
  ['icon-location-barricade', 'icon-location-barricade.webp', 160046],
  ['icon-location-watchtower', 'icon-location-watchtower.webp', 160047],
  ['icon-location-sewer-junction', 'icon-location-sewer-junction.webp', 160048],
  ['icon-location-smugglers-tunnel', 'icon-location-smugglers-tunnel.webp', 160049],
  ['icon-location-armory', 'icon-location-armory.webp', 160050],
  ['icon-location-war-machine-graveyard', 'icon-location-war-machine-graveyard.webp', 160051],
  ['icon-location-construction-site', 'icon-location-construction-site.webp', 160052],
  ['icon-location-fight-pit', 'icon-location-fight-pit.webp', 160053],
  ['icon-location-gym', 'icon-location-gym.webp', 160054],
  ['icon-location-doghouse', 'icon-location-doghouse.webp', 160055],
  ['icon-location-rail-yard', 'icon-location-rail-yard.webp', 160056],
  ['icon-location-tram-depot', 'icon-location-tram-depot.webp', 160057],
  ['icon-location-university', 'icon-location-university.webp', 160058],
  ['icon-location-planetarium', 'icon-location-planetarium.webp', 160059],
  ['icon-location-satellite-uplink', 'icon-location-satellite-uplink.webp', 160060],
  ['icon-location-broadcast-tower', 'icon-location-broadcast-tower.webp', 160061],
  ['icon-location-broadcast-station', 'icon-location-broadcast-station.webp', 160062],
  ['icon-location-pirate-radio', 'icon-location-pirate-radio.webp', 160063],
  ['icon-location-gene-clinic', 'icon-location-gene-clinic.webp', 160064],
  ['icon-location-hospital', 'icon-location-hospital.webp', 160065],
  ['icon-location-black-clinic', 'icon-location-black-clinic.webp', 160066],
  ['icon-location-mad-scientist-lair', 'icon-location-mad-scientist-lair.webp', 160067],
  ['icon-location-tavern', 'icon-location-tavern.webp', 160068],
  ['icon-location-cinema', 'icon-location-cinema.webp', 160069],
  ['icon-location-arcade', 'icon-location-arcade.webp', 160070],
  ['icon-location-skate-ground', 'icon-location-skate-ground.webp', 160071],
  ['icon-location-chapel', 'icon-location-chapel.webp', 160072],
  ['icon-location-graveyard', 'icon-location-graveyard.webp', 160073],
];

/**
 * `prompts.ts` is the only copy of every prompt and `docs/ART-PROMPTS.md` is a hand transcription
 * of it, so the two drift silently. These parse the doc back out; `block()` collapses whitespace
 * before a prompt ever reaches a backend, so the comparison is after collapsing, not line-for-line.
 */
const PROMPT_DOC = readFileSync(
  fileURLToPath(new URL('../../../../docs/ART-PROMPTS.md', import.meta.url)),
  'utf8',
);

/** §1-§5: a per-asset heading, then a fenced `SUBJECT:` block. */
const FENCED_SUBJECT = /^### [\d.]+ `([a-z\d-]+)`[^\n]*\n+```\n(SUBJECT:[\s\S]*?)\n```/gm;

/** §6 instead tabulates the thirteen icons: ``| `icon-caps` | … | `SUBJECT: …` |``. */
const TABLE_SUBJECT = /^\| `([a-z\d-]+)` *\|[^\n]*`(SUBJECT:[^`]*)`/gm;

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');

const documentedSubjects = new Map(
  [...PROMPT_DOC.matchAll(FENCED_SUBJECT), ...PROMPT_DOC.matchAll(TABLE_SUBJECT)].map(
    // Both groups always match; the defaults only satisfy `noUncheckedIndexedAccess`, and an
    // empty key or subject would fail the assertions below rather than pass silently.
    ([, key = '', subject = '']) => [key, collapse(subject.slice('SUBJECT:'.length))] as const,
  ),
);

/** Where each class's framing lives. Typed off `FRAMING`, so a new class cannot skip the check. */
const FRAMING_SECTIONS: Readonly<Record<keyof typeof FRAMING, string>> = {
  portrait: '## 1. ',
  district: '## 2. ',
  plate: '## 3. ',
  building: '## 4. ',
  ui: '## 5. ',
  icon: '## 6. ',
  unit: '## 7. ',
};

/** The shared and per-class blocks are the first fence under their heading rather than keyed. */
const documentedBlock = (heading: string): string => {
  const section = PROMPT_DOC.slice(PROMPT_DOC.indexOf(`\n${heading}`));
  const body = /```\n([\s\S]*?)\n```/.exec(section)?.[1];
  if (body === undefined) throw new Error(`No fenced block under "${heading}" in ART-PROMPTS.md`);
  return collapse(body);
};

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

  it('holds the 125 MVP assets', () => {
    expect(ART_MANIFEST).toHaveLength(125);
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

  /**
   * The district plate is the sole asset off its class size, and it is listed here rather than
   * skipped, so a second one drifting off the table is a failure with a name in it, not a silently
   * widened rule.
   */
  const SIZE_EXCEPTIONS: Record<string, { width: number; height: number; aspect: string }> = {
    // The size the board painted it at. Written down independently of the manifest on purpose:
    // this is the one asset whose delivery size is *load-bearing*: twelve building outlines are
    // positions on this exact image, so a change to it has to be made in two places by somebody
    // who meant it, rather than in one and agreed with automatically.
    'plate-district': { width: 1672, height: 941, aspect: '1672:941' },
  };

  it('matches the ART-BIBLE §6 resolution and aspect table per class', () => {
    const off: string[] = [];
    for (const spec of ART_MANIFEST) {
      const classSpec = ASSET_CLASS_SPECS[spec.class];
      const size = { width: spec.width, height: spec.height, aspect: spec.aspect as string };
      const expected = SIZE_EXCEPTIONS[spec.key] ?? {
        width: classSpec.width,
        height: classSpec.height,
        aspect: classSpec.aspect,
      };
      expect(size, spec.key).toEqual(expected);
      if (SIZE_EXCEPTIONS[spec.key]) off.push(spec.key);
    }
    // Every declared exception is real: an entry left behind for an asset that has gone back to its
    // class size would quietly stop protecting anything.
    expect(off).toEqual(Object.keys(SIZE_EXCEPTIONS));
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
      unit: 'webp90',
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

  it('renders icons at 1024² and downscales: nothing produces 512² with alpha', () => {
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

  it('renders the alpha planes opaque and mattes them: nothing produces 16:9 with alpha', () => {
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

  it('mattes exactly the two planes and the buildings ART-BIBLE §6.2 keys', () => {
    // §6.2's stroke floor is scoped to the keyed assets, which is why it does not contradict
    // §3.2's rim allowance. A third matted asset silently widens that scope: trip the doc first.
    // Buildings joined the keyed set: a delivered master arrives painted on flat white (§6.3), so
    // the class source is declared opaque and the key is the normal path rather than an exception.
    expect(
      ART_MANIFEST.filter((spec) => spec.postProcess.includes('matte')).map((spec) => spec.key),
    ).toEqual([
      'plane-city-far',
      'plane-city-fore',
      ...ART_MANIFEST.filter((spec) => spec.class === 'building').map((spec) => spec.key),
    ]);
  });

  it('names the ART-BIBLE §6.3 key field in both matted prompts, and asks no backend for alpha', () => {
    // The backend cannot emit alpha, so a matted prompt that says "transparent background" leaves the
    // field colour to the model, and a night-sky field lands inside the separation the erasure gate
    // needs to see anything at all. Naming `#ff00ff` is what makes §6.3 satisfiable at all.
    for (const key of ['plane-city-far', 'plane-city-fore'] as const) {
      const subject = PLATE_SUBJECTS[key];
      expect(subject, key).toContain('#ff00ff');
      expect(subject, key).not.toContain('transparent');
    }
  });

  it('carries the ART-BIBLE §6 transparency floors on both matted planes', () => {
    expect(findAssetSpec('plane-city-far')?.minTransparency).toBe(0.3);
    expect(findAssetSpec('plane-city-fore')?.minTransparency).toBe(0.55);
    // §6 names a floor for the planes only; every other asset leaves the gate to the matte checks.
    expect(
      ART_MANIFEST.filter((spec) => spec.minTransparency !== undefined).map((spec) => spec.key),
    ).toEqual(['plane-city-far', 'plane-city-fore']);
  });

  it('leaves the other 54 assets needing no post-process at all', () => {
    // 123 in the manifest, 69 of them post-processed. The title used to say 53 against the same
    // two numbers, which did not add up even before planks: an icon is one of the post-processed
    // ones, so adding a resource moves both figures.
    expect(ART_MANIFEST.filter((spec) => spec.postProcess.length > 0)).toHaveLength(69);
  });

  it('carries the shared prompt blocks as single-line prose', () => {
    for (const text of [STYLE_ANCHOR, NEGATIVE]) {
      expect(text).not.toMatch(/\s{2,}|\n/);
    }
    expect(STYLE_ANCHOR).toContain('#22d3ee');
    expect(NEGATIVE).toContain('cel shading');
  });
});

describe('docs/ART-PROMPTS.md transcribes prompts.ts', () => {
  it('documents a subject for every manifest asset and no others', () => {
    expect([...documentedSubjects.keys()].sort()).toEqual(
      ART_MANIFEST.map((spec) => spec.key).sort(),
    );
  });

  it.each(ART_MANIFEST.map((spec) => [spec.key, spec.prompt.subject] as const))(
    '%s subject reads identically in both',
    (key, subject) => {
      expect(documentedSubjects.get(key)).toBe(subject);
    },
  );

  // The shared and per-class blocks ride on every prompt, so a drift here is a 44-asset drift.
  it.each([
    ['§0.1 style anchor', '### 0.1 ', STYLE_ANCHOR] as const,
    ['§0.2 negative', '### 0.2 ', NEGATIVE] as const,
    ...(Object.keys(FRAMING_SECTIONS) as (keyof typeof FRAMING)[]).map(
      (name) => [`${name} framing`, FRAMING_SECTIONS[name], FRAMING[name]] as const,
    ),
  ])('%s reads identically in both', (_, heading, block) => {
    expect(documentedBlock(heading)).toBe(block);
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
    for (const resource of RESOURCE_KEYS) {
      const subject = resource.replace(/([a-z\d])([A-Z])/g, '$1-$2').toLowerCase();
      expect(subjectResolvesToDomainId('icon', subject)).toBe(true);
    }
    // The camelCase key itself is not a legal subject: only its kebab form is.
    expect(subjectResolvesToDomainId('icon', 'highQualityMetal')).toBe(false);
    for (const archetype of OVERSEER_ARCHETYPES) {
      expect(subjectResolvesToDomainId('icon', `archetype-${archetype}`)).toBe(true);
    }
    for (const kind of DISTRICT_KINDS) {
      expect(subjectResolvesToDomainId('icon', `kind-${kind.replaceAll('_', '-')}`)).toBe(true);
    }
    expect(subjectResolvesToDomainId('icon', 'plutonium')).toBe(false);
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
    postProcess: postProcessFor(source, { width: 1024, height: 1024, alpha: false }, 'crop'),
    ...extra,
  });

  it('rejects a source smaller than the delivery: upscaling invents detail', () => {
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

  it('rejects an asset no backend can render: the MOU-123 failure mode', () => {
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
    expect(postProcessFor({ width: 512, height: 512, alpha: true }, delivery, 'crop')).toEqual([]);
    expect(postProcessFor({ width: 1024, height: 1024, alpha: true }, delivery, 'crop')).toEqual([
      'downscale',
    ]);
    // Matte at master resolution, then downscale: the other order fringes the alpha edge.
    expect(postProcessFor({ width: 1024, height: 1024, alpha: false }, delivery, 'crop')).toEqual([
      'matte',
      'downscale',
    ]);
  });

  /**
   * `trim` is the one step that depends on the *fit* rather than on the source→delivery gap: a
   * cutout the scene positions is cropped to its own artwork, a picture that fills a fixed box is
   * not. It sits between the two, so it keys an image that has an alpha channel to measure and
   * hands the downscale the artwork rather than the artwork plus its margin.
   */
  it('crops a contained cutout to its own artwork, and only a contained one', () => {
    const opaqueMaster = { width: 1024, height: 1024, alpha: false };
    const cutout = { width: 512, height: 512, alpha: true };
    expect(postProcessFor(opaqueMaster, cutout, 'contain')).toEqual(['matte', 'trim', 'downscale']);
    expect(postProcessFor(opaqueMaster, cutout, 'crop')).toEqual(['matte', 'downscale']);
    // An opaque delivery has no alpha box to crop to, however it is fitted.
    expect(
      postProcessFor(opaqueMaster, { width: 512, height: 512, alpha: false }, 'contain'),
    ).toEqual(['downscale']);
  });
});

describe('resolveAssetKey', () => {
  it('builds keys for every domain id in the manifest', () => {
    expect(resolveAssetKey({ type: 'district', districtId: 'neon-docks' })).toBe(
      'district-neon-docks',
    );
    expect(resolveAssetKey({ type: 'building', building: 'scrapyard' })).toBe('building-scrapyard');
    expect(resolveAssetKey({ type: 'portrait', portraitId: 'overseer-2' })).toBe(
      'portrait-overseer-2',
    );
    expect(resolveAssetKey({ type: 'resource-icon', resource: 'highQualityMetal' })).toBe(
      'icon-high-quality-metal',
    );
    expect(resolveAssetKey({ type: 'archetype-icon', archetype: 'fixer' })).toBe(
      'icon-archetype-fixer',
    );
    expect(resolveAssetKey({ type: 'district-kind-icon', districtKind: 'contested' })).toBe(
      'icon-kind-contested',
    );
  });

  it('throws rather than returning a key with no manifest entry', () => {
    expect(() => resolveAssetKey({ type: 'district', districtId: 'nowhere' })).toThrow(
      /No manifest entry/,
    );
  });
});

describe('tryResolveAssetKey', () => {
  it('resolves a known id and answers undefined for an unknown one', () => {
    expect(tryResolveAssetKey({ type: 'portrait', portraitId: 'overseer-2' })).toBe(
      'portrait-overseer-2',
    );
    expect(tryResolveAssetKey({ type: 'portrait', portraitId: 'overseer-9' })).toBeUndefined();
  });
});
