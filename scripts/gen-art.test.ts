import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ART_MANIFEST,
  BACKEND_CAPABILITIES,
  backendCanProduce,
  NEGATIVE,
  STYLE_ANCHOR,
  findAssetSpec,
  type AssetSpec,
} from '@frontline/shared';
import {
  assemblePrompt,
  assertPngMaster,
  buildImageRequest,
  buildProvenance,
  createBackend,
  createFalBackend,
  createOpenAiBackend,
  DEFAULT_OUT_DIR,
  foldNegativeIntoProse,
  main,
  masterOutputPath,
  openAiSize,
  orderForGeneration,
  parseArgs,
  provenanceOutputPath,
  resolveBackendName,
  selectSpecs,
  unproducibleSource,
  validateRun,
  type EmittedPrompt,
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
/** ART-BIBLE §6 — a 1024×1024 asset that must ship with a real alpha channel. */
const FRAME = spec('ui-frame-panel');
/** The two shapes no backend renders directly: 512² alpha, and 16:9 alpha. */
const ICON = spec('icon-alloy');
const FORE_PLANE = spec('plane-city-fore');
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

  it('carries the manifest transparency, so the backends can act on it', () => {
    expect(buildImageRequest(FRAME, OUT).alpha).toBe(true);
    expect(buildImageRequest(DISTRICT, OUT).alpha).toBe(false);
  });

  it('asks for spec.source, not the delivery spec, on the 14 assets where they differ', () => {
    // An icon ships 512² with alpha; nothing renders that, so it is rendered at 1024².
    expect(buildImageRequest(ICON, OUT)).toMatchObject({ width: 1024, height: 1024, alpha: true });
    // The fore plane ships transparent; nothing renders 16:9 alpha, so it is rendered opaque.
    expect(buildImageRequest(FORE_PLANE, OUT)).toMatchObject({
      width: 2048,
      height: 1152,
      alpha: false,
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

  /**
   * `openAiSize` is the API-string mapper; `BACKEND_CAPABILITIES` decides what is producible. Pin
   * them together in both directions — a one-way check lets a size drift into one table only.
   */
  it('maps exactly the sizes the shared capability table advertises', () => {
    const advertised = BACKEND_CAPABILITIES.openai.sizes ?? [];
    expect(advertised).not.toHaveLength(0);
    for (const [width, height] of advertised) {
      expect(openAiSize(width, height), `${width}×${height}`).toBe(`${width}x${height}`);
    }
    for (const [width, height] of [
      [1024, 1024],
      [1024, 1536],
      [1536, 1024],
      [2048, 1152],
      [512, 512],
    ]) {
      const mapped = openAiSize(width!, height!) !== null;
      const capable = backendCanProduce('openai', { width: width!, height: height!, alpha: false });
      expect(mapped, `${width}×${height}`).toBe(capable);
    }
  });

  it('reports why a backend cannot render a source, from the one capability table', () => {
    expect(unproducibleSource('openai', { width: 2048, height: 1152, alpha: false })).toMatch(
      /openai cannot render 2048×1152 — it supports 1024×1024, 1024×1536, 1536×1024, with alpha/,
    );
    expect(unproducibleSource('openai', { width: 1024, height: 1536, alpha: false })).toBeNull();
    // FLUX.2 takes any size but exposes no alpha parameter.
    expect(unproducibleSource('fal', { width: 2048, height: 1152, alpha: false })).toBeNull();
    expect(unproducibleSource('fal', { width: 1024, height: 1024, alpha: true })).toMatch(
      /fal cannot render 1024×1024 with alpha — it supports any size, no alpha/,
    );
  });

  it('advertises each backend’s transparency capability', () => {
    expect(createBackend('fal', {}).supportsAlpha).toBe(false);
    expect(createBackend('openai', {}).supportsAlpha).toBe(true);
  });
});

describe('assertPngMaster', () => {
  it('accepts bytes carrying the PNG signature', () => {
    expect(() => assertPngMaster('plate-city', PNG_BYTES)).not.toThrow();
  });

  it('rejects anything else — `output_format` is unverified wire format', () => {
    // JPEG SOI + APP0.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(() => assertPngMaster('plate-city', jpeg)).toThrow(
      /plate-city: backend returned non-PNG bytes/,
    );
    expect(() => assertPngMaster('plate-city', new Uint8Array([0x89, 0x50]))).toThrow(
      /non-PNG bytes/,
    );
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

  it('refuses an asset that must ship transparent rather than return it matted', async () => {
    stubFetch();
    await expect(
      createFalBackend({ FAL_KEY: 'k' }).generate({
        ...buildImageRequest(FRAME, OUT),
        styleRefPaths: [],
      }),
    ).rejects.toThrow(/fal cannot render 1024×1024 with alpha/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
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
      background: 'opaque',
      output_format: 'png',
      n: 1,
    });
  });

  it('asks for a transparent background on an asset the manifest marks alpha', async () => {
    const { calls } = stubFetch(jsonResponse({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));

    await createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate({
      ...buildImageRequest(FRAME, OUT),
      styleRefPaths: [],
    });

    expect(jsonBody(calls[0]![1])).toMatchObject({
      background: 'transparent',
      // `background: transparent` is only honoured with a png/webp output format.
      output_format: 'png',
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
      expect(form.get('background')).toBe('opaque');
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
    ).rejects.toThrow(/openai cannot render 2048×1152/);
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
      // This master already is the delivery image — no substitution to declare.
      source: { width: 1024, height: 1024, alpha: false },
      postProcess: [],
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
  it('defaults to a live run with no selection of its own', () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, only: [], all: false });
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
      emitPrompts: false,
      outDir: '/tmp/art',
      only: ['plate-city', 'ui-divider'],
      all: false,
    });
  });

  it('reads --all and refuses to guess when it contradicts --only', () => {
    expect(parseArgs(['--all'])).toMatchObject({ all: true, only: [] });
    expect(() => parseArgs(['--all', '--only', 'plate-city'])).toThrow(/mutually exclusive/);
    expect(() => parseArgs(['--only', 'plate-city', '--all'])).toThrow(/mutually exclusive/);
  });

  it('reads --emit-prompts, which composes with --only', () => {
    expect(parseArgs(['--emit-prompts', '--only', 'plate-city'])).toMatchObject({
      emitPrompts: true,
      only: ['plate-city'],
    });
    expect(parseArgs([]).emitPrompts).toBe(false);
  });

  it('names --emit-prompts in the usage line', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/--emit-prompts/);
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--out'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--only', '--dry-run'])).toThrow(/needs a value/);
  });

  // `--only "$KEY"` with an unset variable used to select nothing, which selected everything.
  it('rejects an --only that names no key instead of reading it as the whole manifest', () => {
    expect(() => parseArgs(['--only', ''])).toThrow(/selected no asset keys/);
    expect(() => parseArgs(['--only', ',,'])).toThrow(/selected no asset keys/);
    // Per --only, not per run: an earlier good selector must not absorb a later empty one.
    expect(() => parseArgs(['--only', 'plate-city', '--only', ''])).toThrow(
      /selected no asset keys/,
    );
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
  const env: Env = { FRONTLINE_ART_BACKEND: 'fal' };

  it('passes on the shipped manifest', () => {
    expect(validateRun(ART_MANIFEST, OUT, env)).toEqual([]);
  });

  /**
   * MOU-126 blocking regression: with no selector at all this returned `[]`, so `--dry-run` exited
   * 0 on a run that bills for every pinned asset it reaches and then throws on the first unpinned
   * one. The 11 districts carry no capability pin, so the whole manifest must fail.
   */
  it('fails when nothing selects a backend for an unpinned asset', () => {
    const problems = validateRun(ART_MANIFEST, OUT, {});
    expect(problems).not.toEqual([]);
    expect(problems).toContainEqual(
      'district-chrome-row: not pinned to a backend and FRONTLINE_ART_BACKEND is unset — set it to "fal" or "openai"',
    );
    expect(problems).toHaveLength(ART_MANIFEST.filter((s) => s.backend === undefined).length);
  });

  /** A `--only` run over capability-pinned assets is legitimately runnable with no selector. */
  it('needs no selector for an asset the manifest pins', () => {
    expect(validateRun([PORTRAIT, FRAME, ICON], OUT, {})).toEqual([]);
  });

  it('reports an ART-BIBLE violation against the offending key', () => {
    const broken: AssetSpec = { ...DISTRICT, width: 640, height: 480 };
    expect(validateRun([broken], OUT, env)).toContainEqual(
      expect.stringContaining('district-chrome-row: '),
    );
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

  /** MOU-123 acceptance: whichever backend the operator picks, all 44 assets are producible. */
  it('passes on the whole manifest under either backend', () => {
    expect(validateRun(ART_MANIFEST, OUT, { FRONTLINE_ART_BACKEND: 'fal' })).toEqual([]);
    expect(validateRun(ART_MANIFEST, OUT, { FRONTLINE_ART_BACKEND: 'openai' })).toEqual([]);
  });

  it('routes around a backend that cannot deliver, via the manifest pin rather than silently', () => {
    // 16:9 has no gpt-image-1 size; 1024² alpha has no fal equivalent. Both are pinned, so the
    // env var cannot send either one somewhere that would fail.
    expect(PLATE.backend).toBe('fal');
    expect(validateRun([PLATE], OUT, { FRONTLINE_ART_BACKEND: 'openai' })).toEqual([]);
    expect(FRAME.backend).toBe('openai');
    expect(validateRun([FRAME], OUT, { FRONTLINE_ART_BACKEND: 'fal' })).toEqual([]);
  });

  it('fails the run rather than let an unpinned asset rewrite a manifest resolution', () => {
    const unpinned: AssetSpec = { ...PLATE, backend: undefined };
    expect(validateRun([unpinned], OUT, { FRONTLINE_ART_BACKEND: 'openai' })).toContainEqual(
      expect.stringContaining('plate-city: openai cannot render 2048×1152'),
    );
    expect(validateRun([unpinned], OUT, { FRONTLINE_ART_BACKEND: 'fal' })).toEqual([]);
  });

  it('fails the run rather than pay fal for an asset that comes back opaque', () => {
    const unpinned: AssetSpec = { ...FRAME, backend: undefined };
    expect(validateRun([unpinned], OUT, { FRONTLINE_ART_BACKEND: 'fal' })).toContainEqual(
      expect.stringContaining('ui-frame-panel: fal cannot render 1024×1024 with alpha'),
    );
  });

  /** An icon's guard must run against its 1024² render, not its 512² delivery. */
  it('validates the source a backend is asked for, not the delivery spec', () => {
    const icon = spec('icon-alloy');
    expect(validateRun([icon], OUT, { FRONTLINE_ART_BACKEND: 'openai' })).toEqual([]);
    expect(
      validateRun([{ ...icon, backend: undefined }], OUT, { FRONTLINE_ART_BACKEND: 'fal' }),
    ).toContainEqual(expect.stringContaining('icon-alloy: fal cannot render 1024×1024 with alpha'));
  });
});

describe('main --dry-run', () => {
  const DRY_RUN_ENV: Env = { FRONTLINE_ART_BACKEND: 'fal' };

  it('validates the whole manifest and exits 0 with no network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], DRY_RUN_ENV)).resolves.toBe(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stdout.join('')).toContain('44 asset(s) validated');
    expect(output.stdout.join('')).toContain(`${OUT}/district-neon-docks.png`);
  });

  /** The regression the reviewer reproduced: this used to exit 0 and then bill five assets. */
  it('refuses a run with no backend selected instead of exiting 0', async () => {
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], {})).resolves.toBe(1);

    expect(output.stderr.join('')).toContain('FRONTLINE_ART_BACKEND is unset');
  });

  it('names the backend per asset and tallies the split that drives the bill', async () => {
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], DRY_RUN_ENV)).resolves.toBe(0);

    const stdout = output.stdout.join('');
    // Capability-pinned to openai despite the operator asking for fal.
    expect(stdout).toContain(`${OUT}/ui-frame-panel.png  openai  seed`);
    expect(stdout).toContain(`${OUT}/district-neon-docks.png  fal  seed`);
    const pinned = ART_MANIFEST.filter((s) => s.backend === 'openai').length;
    expect(stdout).toContain(`backends: fal ${ART_MANIFEST.length - pinned}, openai ${pinned}`);
  });

  it('names the encode step a master still needs rather than implying it is the asset', async () => {
    const output = captureOutput();

    await expect(main(['--dry-run', '--out', OUT], DRY_RUN_ENV)).resolves.toBe(0);

    const stdout = output.stdout.join('');
    expect(stdout).toContain('14 master(s) are not the delivery image (matte 2, downscale 12)');
    expect(stdout).toContain('encode-art');
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

// MOU-145: `--only ""` was closed first, but a bare invocation reached the same 44-asset bill by a
// shorter path — a stray Enter, or a wrapper script that dropped its args.
describe('main funded-selection gate', () => {
  const FUNDED_ENV: Env = { FRONTLINE_ART_BACKEND: 'fal', FAL_KEY: 'k' };

  it('refuses a bare funded run over the whole manifest, before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    await expect(main([], FUNDED_ENV)).resolves.toBe(1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderr.join('')).toContain(`all ${ART_MANIFEST.length} manifest assets`);
    expect(output.stderr.join('')).toContain('--all');
  });

  it('lets --all through the gate, leaving the run to fail on its own merits', async () => {
    const output = captureOutput();

    await expect(main(['--all'], {})).resolves.toBe(1);

    expect(output.stderr.join('')).toContain('FRONTLINE_ART_BACKEND is unset');
    expect(output.stderr.join('')).not.toContain('without an explicit selection');
  });

  it('leaves the wildcard alone where it spends nothing', async () => {
    const output = captureOutput();

    await expect(main(['--dry-run'], FUNDED_ENV)).resolves.toBe(0);

    expect(output.stdout.join('')).toContain(`${ART_MANIFEST.length} asset(s) validated`);
  });
});

describe('foldNegativeIntoProse', () => {
  it('is the single fold every negative-less route uses', () => {
    expect(foldNegativeIntoProse('a subject', 'blur, watermark')).toBe(
      'a subject\n\nAvoid entirely: blur, watermark',
    );
  });

  it('produces exactly what the gpt-image-1 adapter posts', async () => {
    const { calls } = stubFetch(jsonResponse({ data: [{ b64_json: 'iVBORw0KGgo=' }] }));

    await createOpenAiBackend({ OPENAI_API_KEY: 'k' }).generate({
      ...buildImageRequest(PORTRAIT, OUT),
      styleRefPaths: [],
    });

    expect(jsonBody(calls[0]![1])).toMatchObject({
      prompt: foldNegativeIntoProse(assemblePrompt(PORTRAIT), NEGATIVE),
    });
  });
});

describe('main --emit-prompts', () => {
  /** The mode's contract is machine-readable stdout — parse it rather than string-matching. */
  async function emit(...argv: string[]): Promise<EmittedPrompt[]> {
    const output = captureOutput();
    await expect(main(['--emit-prompts', ...argv], {})).resolves.toBe(0);
    return JSON.parse(output.stdout.join('')) as EmittedPrompt[];
  }

  it('emits valid JSON for exactly the selected key, with no keys and no network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const emitted = await emit('--only', 'portrait-overseer-1');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      key: 'portrait-overseer-1',
      width: PORTRAIT.source.width,
      height: PORTRAIT.source.height,
      aspect: PORTRAIT.aspect,
      alpha: PORTRAIT.source.alpha,
      seed: PORTRAIT.seed,
    });
  });

  it('emits the exact assembled prompt with the negative folded in', async () => {
    const [emitted] = await emit('--only', 'district-chrome-row');

    expect(emitted!.prompt).toBe(foldNegativeIntoProse(assemblePrompt(DISTRICT), NEGATIVE));
    expect(emitted!.prompt.startsWith(STYLE_ANCHOR)).toBe(true);
    expect(emitted!.prompt).toContain(DISTRICT.prompt.subject);
    expect(emitted!.prompt).toContain(DISTRICT.prompt.framing);
    expect(emitted!.prompt).toContain(`Avoid entirely: ${NEGATIVE}`);
  });

  /** A pasted asset must be able to carry the provenance the generator would have written. */
  it('hashes the prompt exactly as buildProvenance does', async () => {
    const [emitted] = await emit('--only', 'district-chrome-row');

    const record = buildProvenance(
      DISTRICT,
      createBackend('fal', {}),
      buildImageRequest(DISTRICT, OUT),
      new Date('2026-08-12T09:30:00.000Z'),
    );
    expect(emitted!.promptSha256).toBe(record.promptSha256);
  });

  it('asks for spec.source, not the delivery spec, where they differ', async () => {
    const [icon] = await emit('--only', 'icon-alloy');

    // Ships 512² with alpha; nothing renders that, so the paste target is the 1024² master.
    expect(icon).toMatchObject({ width: 1024, height: 1024, alpha: true, aspect: '1:1' });
  });

  it('emits in generation order, whatever order --only names the keys', async () => {
    const emitted = await emit('--only', 'district-chrome-row,plate-city');

    expect(emitted.map((entry) => entry.key)).toEqual(['plate-city', 'district-chrome-row']);
  });

  it('exits non-zero on an unknown asset key', async () => {
    const output = captureOutput();
    await expect(main(['--emit-prompts', '--only', 'district-atlantis'], {})).resolves.toBe(1);
    expect(output.stderr.join('')).toContain('Unknown asset key');
  });

  it('covers the whole manifest by default', async () => {
    const emitted = await emit();
    expect(emitted).toHaveLength(ART_MANIFEST.length);
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

  it('refuses to write a non-PNG master into a .png', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'frontline-art-'));
    try {
      stubFetch(
        jsonResponse({ images: [{ url: 'https://cdn.fal.test/a.jpg' }] }),
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
      );
      const output = captureOutput();

      const code = await main(['--out', dir, '--only', 'plate-city'], {
        FRONTLINE_ART_BACKEND: 'fal',
        FAL_KEY: 'k',
      });

      expect(code).toBe(1);
      expect(output.stderr.join('')).toContain('plate-city: backend returned non-PNG bytes');
      await expect(readFile(path.join(dir, 'plate-city.png'))).rejects.toThrow(/ENOENT/);
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
