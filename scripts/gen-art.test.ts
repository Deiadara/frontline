import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ART_MANIFEST,
  NEGATIVE,
  STYLE_ANCHOR,
  findAssetSpec,
  type AssetSpec,
} from '@frontline/shared';
import {
  assemblePrompt,
  assetOutputPath,
  buildImageRequest,
  buildProvenance,
  createBackend,
  DEFAULT_OUT_DIR,
  main,
  openAiSize,
  parseArgs,
  provenanceOutputPath,
  resolveBackendName,
  selectSpecs,
  validateRun,
  type Env,
} from './gen-art.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

const DISTRICT = spec('district-chrome-row');
const PORTRAIT = spec('portrait-overseer-1');
const OUT = '/tmp/frontline-art';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Silences the runner's stdio and returns everything it wrote. */
function captureOutput(): { stdout: string[]; stderr: string[] } {
  const captured = { stdout: [] as string[], stderr: [] as string[] };
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    captured.stderr.push(String(chunk));
    return true;
  });
  return captured;
}

describe('assemblePrompt', () => {
  it('is STYLE_ANCHOR + SUBJECT + FRAMING, in that order', () => {
    const prompt = assemblePrompt(DISTRICT);
    expect(prompt).toBe(
      `${STYLE_ANCHOR}\n\n${DISTRICT.prompt.subject}\n\n${DISTRICT.prompt.framing}`,
    );
    expect(prompt.indexOf(DISTRICT.prompt.subject)).toBeLessThan(
      prompt.indexOf(DISTRICT.prompt.framing),
    );
  });

  it('never paraphrases the anchor — every asset carries the identical block', () => {
    for (const asset of ART_MANIFEST) {
      expect(assemblePrompt(asset).startsWith(STYLE_ANCHOR)).toBe(true);
    }
  });
});

describe('buildImageRequest', () => {
  it('carries the manifest resolution, seed and shared negative', () => {
    const request = buildImageRequest(DISTRICT, OUT);
    expect(request).toMatchObject({
      negative: NEGATIVE,
      seed: DISTRICT.seed,
      width: DISTRICT.width,
      height: DISTRICT.height,
    });
  });

  it('resolves style refs to on-disk paths under the output dir', () => {
    expect(buildImageRequest(DISTRICT, OUT).styleRefPaths).toEqual([
      `${OUT}/district-neon-docks.webp`,
      `${OUT}/portrait-overseer-1.webp`,
    ]);
    expect(buildImageRequest(spec('plate-city'), OUT).styleRefPaths).toEqual([]);
  });
});

describe('path derivation', () => {
  it('writes each asset under its manifest filename', () => {
    expect(assetOutputPath(OUT, DISTRICT)).toBe(`${OUT}/district-chrome-row.webp`);
    expect(assetOutputPath(OUT, spec('ui-frame-panel'))).toBe(`${OUT}/ui-frame-panel.png`);
  });

  it('writes a sibling provenance file per asset', () => {
    expect(provenanceOutputPath(OUT, DISTRICT)).toBe(`${OUT}/district-chrome-row.provenance.json`);
    expect(provenanceOutputPath(OUT, spec('ui-frame-panel'))).toBe(
      `${OUT}/ui-frame-panel.provenance.json`,
    );
  });

  it('defaults to the repo asset tree', () => {
    expect(parseArgs([]).outDir).toBe(DEFAULT_OUT_DIR);
    expect(DEFAULT_OUT_DIR.endsWith('/assets')).toBe(true);
  });
});

describe('backend selection', () => {
  it('honours the per-asset override ahead of the env var', () => {
    expect(resolveBackendName(PORTRAIT, { FRONTLINE_ART_BACKEND: 'fal' })).toBe('openai');
  });

  it('falls back to FRONTLINE_ART_BACKEND', () => {
    expect(resolveBackendName(DISTRICT, { FRONTLINE_ART_BACKEND: 'fal' })).toBe('fal');
    expect(resolveBackendName(DISTRICT, { FRONTLINE_ART_BACKEND: 'openai' })).toBe('openai');
  });

  it('refuses to guess a backend', () => {
    expect(() => resolveBackendName(DISTRICT, {})).toThrow(/FRONTLINE_ART_BACKEND is unset/);
    expect(() => resolveBackendName(DISTRICT, { FRONTLINE_ART_BACKEND: 'freeflux' })).toThrow(
      /Unknown FRONTLINE_ART_BACKEND/,
    );
  });

  it('builds adapters without touching the network and records their licence', () => {
    const fal = createBackend('fal', {});
    expect(fal).toMatchObject({ name: 'fal', model: 'fal-ai/flux-2/pro' });
    expect(fal.licence).toMatch(/fal\.ai/);
    expect(createBackend('openai', {})).toMatchObject({ name: 'openai', model: 'gpt-image-1' });
  });

  it('lets FRONTLINE_FAL_MODEL pin a different fal model', () => {
    expect(createBackend('fal', { FRONTLINE_FAL_MODEL: 'fal-ai/flux/dev' }).model).toBe(
      'fal-ai/flux/dev',
    );
  });

  it('maps manifest resolutions onto gpt-image-1 sizes', () => {
    expect(openAiSize(1024, 1536)).toBe('1024x1536');
    expect(openAiSize(1024, 1024)).toBe('1024x1024');
    expect(openAiSize(2048, 1152)).toBe('1536x1024');
  });
});

describe('buildProvenance', () => {
  it('records everything ADR 0001 §6.4 asks for', () => {
    const backend = createBackend('fal', {});
    const prompt = assemblePrompt(DISTRICT);
    const record = buildProvenance(DISTRICT, backend, prompt, new Date('2026-08-12T09:30:00.000Z'));

    const { promptSha256, ...rest } = record;
    expect(rest).toEqual({
      assetKey: 'district-chrome-row',
      file: 'district-chrome-row.webp',
      backend: 'fal',
      model: 'fal-ai/flux-2/pro',
      seed: DISTRICT.seed,
      generatedAt: '2026-08-12T09:30:00.000Z',
      licence: backend.licence,
      humanEdited: false,
    });
    expect(promptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the prompt, so a prompt edit is visible in the record', () => {
    const backend = createBackend('fal', {});
    const at = new Date('2026-08-12T09:30:00.000Z');
    const a = buildProvenance(DISTRICT, backend, assemblePrompt(DISTRICT), at);
    const b = buildProvenance(DISTRICT, backend, `${assemblePrompt(DISTRICT)} extra`, at);
    expect(a.promptSha256).not.toBe(b.promptSha256);
  });
});

describe('parseArgs', () => {
  it('defaults to a live run over the whole manifest', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, only: [] });
  });

  it('reads --dry-run, --out and a comma-separated --only', () => {
    const options = parseArgs([
      '--dry-run',
      '--out',
      '/tmp/art',
      '--only',
      'plate-city,ui-divider',
    ]);
    expect(options).toEqual({
      dryRun: true,
      outDir: '/tmp/art',
      only: ['plate-city', 'ui-divider'],
    });
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--out'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--only', '--dry-run'])).toThrow(/needs a value/);
  });
});

describe('selectSpecs', () => {
  it('returns the whole manifest by default and the named subset otherwise', () => {
    expect(selectSpecs([])).toHaveLength(ART_MANIFEST.length);
    expect(selectSpecs(['icon-alloy']).map((s) => s.key)).toEqual(['icon-alloy']);
    expect(() => selectSpecs(['icon-scrap'])).toThrow(/Unknown asset key/);
  });
});

describe('validateRun', () => {
  const env: Env = {};

  it('passes on the shipped manifest', () => {
    expect(validateRun(ART_MANIFEST, OUT, env)).toEqual([]);
  });

  it('reports an ART-BIBLE violation against the offending key', () => {
    const broken: AssetSpec = { ...DISTRICT, width: 640, height: 480 };
    expect(validateRun([broken], OUT, env)).toEqual([
      expect.stringContaining('district-chrome-row: '),
    ]);
  });

  it('catches two assets claiming the same output path', () => {
    const clone: AssetSpec = { ...DISTRICT, key: 'district-undergrid' };
    expect(validateRun([DISTRICT, clone], OUT, env)).toContainEqual(
      expect.stringContaining('output path collides'),
    );
  });

  it('rejects an unusable FRONTLINE_ART_BACKEND', () => {
    expect(validateRun([DISTRICT], OUT, { FRONTLINE_ART_BACKEND: 'freeflux' })).toContainEqual(
      expect.stringContaining('unknown FRONTLINE_ART_BACKEND'),
    );
  });
});

describe('main --dry-run', () => {
  it('validates the whole manifest and exits 0 with no network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], {})).resolves.toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stdout.join('')).toContain('44 asset(s) validated');
    expect(output.stdout.join('')).toContain(`${OUT}/district-neon-docks.webp`);
  });

  it('exits non-zero on an unknown asset key', async () => {
    const output = captureOutput();
    await expect(main(['--dry-run', '--only', 'district-atlantis'], {})).resolves.toBe(1);
    expect(output.stderr.join('')).toContain('Unknown asset key');
  });

  it('exits non-zero on a bad flag', async () => {
    captureOutput();
    await expect(main(['--nope'], {})).resolves.toBe(1);
  });

  it('needs no backend or credentials', async () => {
    captureOutput();
    await expect(main(['--dry-run', '--only', 'portrait-overseer-1'], {})).resolves.toBe(0);
  });
});
