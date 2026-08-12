import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  buildImageRequest,
  buildProvenance,
  createBackend,
  createFalBackend,
  createOpenAiBackend,
  DEFAULT_OUT_DIR,
  main,
  masterOutputPath,
  openAiSize,
  orderForGeneration,
  parseArgs,
  provenanceOutputPath,
  resolveBackendName,
  selectSpecs,
  unsupportedResolution,
  validateRun,
  type Env,
  type ImageRequest,
} from './gen-art.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

const DISTRICT = spec('district-chrome-row');
const PORTRAIT = spec('portrait-overseer-1');
const PLATE = spec('plate-city');
const OUT = '/tmp/frontline-art';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

  it('resolves style refs to the on-disk masters under the output dir', () => {
    expect(buildImageRequest(DISTRICT, OUT).styleRefPaths).toEqual([
      `${OUT}/district-neon-docks.png`,
      `${OUT}/portrait-overseer-1.png`,
    ]);
    expect(buildImageRequest(PLATE, OUT).styleRefPaths).toEqual([]);
  });
});

describe('path derivation', () => {
  it('writes every asset as a lossless PNG master, whatever its delivery format', () => {
    expect(masterOutputPath(OUT, DISTRICT)).toBe(`${OUT}/district-chrome-row.png`);
    expect(masterOutputPath(OUT, spec('ui-frame-panel'))).toBe(`${OUT}/ui-frame-panel.png`);
  });

  it('writes a sibling provenance file per asset', () => {
    expect(provenanceOutputPath(OUT, DISTRICT)).toBe(`${OUT}/district-chrome-row.provenance.json`);
  });

  it('defaults to the master tree outside the app bundle', () => {
    expect(parseArgs([]).outDir).toBe(DEFAULT_OUT_DIR);
    expect(DEFAULT_OUT_DIR.endsWith('/art-src')).toBe(true);
  });
});

describe('orderForGeneration', () => {
  it('runs plates and planes first, then the two style references (ART-PROMPTS §7.1)', () => {
    const ordered = orderForGeneration(ART_MANIFEST).map((s) => s.key);
    expect(ordered.slice(0, 6)).toEqual([
      'plate-city',
      'plane-city-sky',
      'plane-city-far',
      'plane-city-fore',
      'portrait-overseer-1',
      'district-neon-docks',
    ]);
    expect(ordered).toHaveLength(ART_MANIFEST.length);
    expect(new Set(ordered).size).toBe(ART_MANIFEST.length);
  });

  it('never places a referencing asset before a reference', () => {
    const ordered = orderForGeneration(ART_MANIFEST);
    for (const [index, current] of ordered.entries()) {
      for (const ref of current.styleRefs) {
        expect(ordered.findIndex((s) => s.key === ref)).toBeLessThan(index);
      }
    }
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
    expect(fal).toMatchObject({ name: 'fal', model: 'fal-ai/flux-2/pro', honorsSeed: true });
    expect(fal.licence).toMatch(/fal\.ai/);
    expect(createBackend('openai', {})).toMatchObject({
      name: 'openai',
      model: 'gpt-image-1',
      honorsSeed: false,
    });
  });

  it('lets FRONTLINE_FAL_MODEL pin a different fal model', () => {
    expect(createBackend('fal', { FRONTLINE_FAL_MODEL: 'fal-ai/flux/dev' }).model).toBe(
      'fal-ai/flux/dev',
    );
  });

  it('maps only the resolutions gpt-image-1 actually supports', () => {
    expect(openAiSize(1024, 1536)).toBe('1024x1536');
    expect(openAiSize(1024, 1024)).toBe('1024x1024');
    expect(openAiSize(1536, 1024)).toBe('1536x1024');
    // 16:9 plates/planes/splashes have no gpt-image-1 equivalent — never silently substitute one.
    expect(openAiSize(2048, 1152)).toBeNull();
    expect(openAiSize(512, 512)).toBeNull();
  });

  it('reports a resolution a backend cannot deliver', () => {
    expect(unsupportedResolution('openai', 2048, 1152)).toMatch(/cannot produce 2048×1152/);
    expect(unsupportedResolution('openai', 1024, 1536)).toBeNull();
    expect(unsupportedResolution('fal', 2048, 1152)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Adapters — mocked fetch only; no request ever leaves the process.           */
/* -------------------------------------------------------------------------- */

function request(overrides: Partial<ImageRequest> = {}): ImageRequest {
  return { ...buildImageRequest(DISTRICT, OUT), styleRefPaths: [], ...overrides };
}

/** The adapters always fetch a plain URL; anything else is a test-harness bug. */
function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  throw new Error('expected a string or URL fetch target');
}

/** The posted JSON body, or a failure if the adapter did not send one. */
function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('expected a JSON request body');
  return JSON.parse(body);
}

/** Captures every fetch call and answers each one with `responses[i]`. */
function stubFetch(...responses: Response[]): { calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = [];
  let index = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    calls.push([urlOf(input), init]);
    const response = responses[index];
    index += 1;
    if (!response) throw new Error(`unexpected fetch call #${index}`);
    return Promise.resolve(response);
  });
  return { calls };
}

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'text/json' } });

describe('fal adapter', () => {
  it('posts the assembled prompt, manifest size, seed and a lossless output format', async () => {
    const { calls } = stubFetch(
      jsonResponse({ images: [{ url: 'https://cdn.fal.test/a.png' }] }),
      new Response(PNG_BYTES),
    );

    const req = request();
    const bytes = await createFalBackend({ FAL_KEY: 'k' }).generate(req);

    expect(bytes).toEqual(PNG_BYTES);
    const [url, init] = calls[0]!;
    expect(url).toBe('https://fal.run/fal-ai/flux-2/pro');
    expect(jsonBody(init)).toEqual({
      prompt: req.prompt,
      negative_prompt: NEGATIVE,
      image_size: { width: DISTRICT.width, height: DISTRICT.height },
      seed: DISTRICT.seed,
      num_images: 1,
      num_inference_steps: 40,
      guidance_scale: 4.5,
      output_format: 'png',
    });
    expect(calls[1]![0]).toBe('https://cdn.fal.test/a.png');
  });

  it('surfaces the error body — the only thing that names a wrong field', async () => {
    stubFetch(
      new Response('{"detail":"unknown field image_size"}', {
        status: 422,
        statusText: 'Unprocessable Entity',
      }),
    );
    await expect(createFalBackend({ FAL_KEY: 'k' }).generate(request())).rejects.toThrow(
      /fal request failed: 422 Unprocessable Entity — \{"detail":"unknown field image_size"\}/,
    );
  });

  it('needs its key', async () => {
    await expect(createFalBackend({}).generate(request())).rejects.toThrow(/FAL_KEY is unset/);
  });
});

describe('openai adapter', () => {
  const portraitRequest = (styleRefPaths: readonly string[] = []): ImageRequest => ({
    ...buildImageRequest(PORTRAIT, OUT),
    styleRefPaths,
  });

  it('posts to the generations endpoint with the negative folded into the prompt', async () => {
    const { calls } = stubFetch(jsonResponse({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));

    const bytes = await createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate(portraitRequest());

    expect(bytes).toEqual(new Uint8Array(Buffer.from('iVBORw0KGgo=', 'base64')));
    const [url, init] = calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(jsonBody(init)).toEqual({
      model: 'gpt-image-1',
      prompt: `${assemblePrompt(PORTRAIT)}\n\nAvoid entirely: ${NEGATIVE}`,
      size: '1024x1536',
      quality: 'high',
      output_format: 'png',
      n: 1,
    });
  });

  it('routes through the edit endpoint with the style references attached (§7.3)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontline-art-'));
    try {
      const refPath = path.join(dir, 'district-neon-docks.png');
      await writeFile(refPath, PNG_BYTES);
      const { calls } = stubFetch(jsonResponse({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));

      await createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate(portraitRequest([refPath]));

      const [url, init] = calls[0]!;
      expect(url).toBe('https://api.openai.com/v1/images/edits');
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe('gpt-image-1');
      expect(form.get('size')).toBe('1024x1536');
      expect(form.getAll('image[]')).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a resolution it cannot produce rather than substituting one', async () => {
    stubFetch();
    await expect(
      createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate({
        ...buildImageRequest(PLATE, OUT),
        styleRefPaths: [],
      }),
    ).rejects.toThrow(/cannot produce 2048×1152/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('surfaces the error body', async () => {
    stubFetch(
      new Response('{"error":{"message":"Unknown parameter: output_format"}}', {
        status: 400,
        statusText: 'Bad Request',
      }),
    );
    await expect(
      createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate(portraitRequest()),
    ).rejects.toThrow(/openai request failed: 400 Bad Request — .*Unknown parameter/);
  });
});

describe('buildProvenance', () => {
  it('records everything ADR 0001 §6.4 asks for', () => {
    const backend = createBackend('fal', {});
    const req = buildImageRequest(DISTRICT, OUT);
    const record = buildProvenance(DISTRICT, backend, req, new Date('2026-08-12T09:30:00.000Z'));

    const { promptSha256, ...rest } = record;
    expect(rest).toEqual({
      assetKey: 'district-chrome-row',
      masterFile: 'district-chrome-row.png',
      deliveryFile: 'district-chrome-row.webp',
      backend: 'fal',
      model: 'fal-ai/flux-2/pro',
      seed: DISTRICT.seed,
      styleRefsApplied: true,
      generatedAt: '2026-08-12T09:30:00.000Z',
      licence: backend.licence,
      humanEdited: false,
    });
    expect(promptSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records no seed for a backend that cannot honour one', () => {
    const record = buildProvenance(
      PORTRAIT,
      createBackend('openai', {}),
      buildImageRequest(PORTRAIT, OUT),
      new Date('2026-08-12T09:30:00.000Z'),
    );
    expect(record.seed).toBeNull();
    expect(record.styleRefsApplied).toBe(false);
  });

  it('hashes the prompt, so a prompt edit is visible in the record', () => {
    const backend = createBackend('fal', {});
    const at = new Date('2026-08-12T09:30:00.000Z');
    const req = buildImageRequest(DISTRICT, OUT);
    const a = buildProvenance(DISTRICT, backend, req, at);
    const b = buildProvenance(DISTRICT, backend, { ...req, prompt: `${req.prompt} extra` }, at);
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

  it('catches two runs claiming the same output path', () => {
    expect(validateRun([DISTRICT, DISTRICT], OUT, env)).toContainEqual(
      expect.stringContaining('output path collides'),
    );
  });

  it('rejects an unusable FRONTLINE_ART_BACKEND', () => {
    expect(validateRun([DISTRICT], OUT, { FRONTLINE_ART_BACKEND: 'freeflux' })).toContainEqual(
      expect.stringContaining('unknown FRONTLINE_ART_BACKEND'),
    );
  });

  it('fails the run rather than let a backend rewrite a manifest resolution', () => {
    expect(validateRun([PLATE], OUT, { FRONTLINE_ART_BACKEND: 'openai' })).toContainEqual(
      expect.stringContaining('plate-city: gpt-image-1 cannot produce 2048×1152'),
    );
    expect(validateRun([PLATE], OUT, { FRONTLINE_ART_BACKEND: 'fal' })).toEqual([]);
  });
});

describe('main --dry-run', () => {
  it('validates the whole manifest and exits 0 with no network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], {})).resolves.toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stdout.join('')).toContain('44 asset(s) validated');
    expect(output.stdout.join('')).toContain(`${OUT}/district-neon-docks.png`);
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

describe('main — live run', () => {
  it('writes the PNG master and a parseable provenance record', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontline-art-'));
    try {
      stubFetch(
        jsonResponse({ images: [{ url: 'https://cdn.fal.test/a.png' }] }),
        new Response(PNG_BYTES),
      );
      captureOutput();

      const code = await main(['--out', dir, '--only', 'plate-city'], {
        FRONTLINE_ART_BACKEND: 'fal',
        FAL_KEY: 'k',
      });

      expect(code).toBe(0);
      expect(new Uint8Array(await readFile(path.join(dir, 'plate-city.png')))).toEqual(PNG_BYTES);
      const record: unknown = JSON.parse(
        await readFile(path.join(dir, 'plate-city.provenance.json'), 'utf8'),
      );
      expect(record).toMatchObject({
        assetKey: 'plate-city',
        masterFile: 'plate-city.png',
        deliveryFile: 'plate-city.webp',
        backend: 'fal',
        seed: PLATE.seed,
        styleRefsApplied: false,
        humanEdited: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to spend money on an asset whose style refs do not exist yet', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontline-art-'));
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const output = captureOutput();

      const code = await main(['--out', dir, '--only', 'district-chrome-row'], {
        FRONTLINE_ART_BACKEND: 'fal',
        FAL_KEY: 'k',
      });

      expect(code).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(output.stderr.join('')).toContain(
        'district-chrome-row: style ref district-neon-docks has not been generated yet',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
