/**
 * Manifest-driven art generation (ADR 0001 §6, docs/ART-PROMPTS.md).
 *
 * Every asset is described once, in `@frontline/shared`'s `ART_MANIFEST`. This runner assembles
 * `STYLE_ANCHOR + SUBJECT + FRAMING` for each entry, hands it to a pluggable {@link ImageBackend},
 * writes the returned bytes as a **lossless PNG master** under `art-src/` and drops a
 * `*.provenance.json` beside it. Turning a master into its ART-BIBLE §6 delivery file
 * (`spec.file` — WebP at `ASSET_CLASS_SPECS[class].quality`) and the 1×/2× split belong to the
 * AssetPack step; masters live outside the app bundle and are never shipped (ART-BIBLE §6).
 *
 * A backend is asked for `spec.source`, not `spec.file`'s resolution. For 14 assets those differ —
 * no backend renders 512×512 with alpha, and none renders 16:9 with alpha at all — so the manifest
 * declares the nearest producible render plus the `spec.postProcess` steps (`downscale`, `matte`)
 * that close the gap. The steps are recorded in provenance and applied by the AssetPack encode
 * step; declaring them is what keeps the substitution deliberate instead of silent.
 *
 *   pnpm --filter @frontline/scripts gen-art -- --dry-run
 *   pnpm --filter @frontline/scripts gen-art -- --emit-prompts --only plate-city
 *   FRONTLINE_ART_BACKEND=fal FAL_KEY=… pnpm --filter @frontline/scripts gen-art
 *
 * `--dry-run` makes **zero** network calls and is what CI exercises; it exits non-zero on any
 * validation failure. No backend is activated by default — see ADR 0001 §6.2 for why there is
 * deliberately no key-free route.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ART_MANIFEST,
  BACKEND_CAPABILITIES,
  GENERATION_SETTINGS,
  ImageBackendNameSchema,
  NEGATIVE,
  STYLE_ANCHOR,
  STYLE_REFERENCE_KEYS,
  backendCanProduce,
  findAssetSpec,
  validateAssetSpec,
  type AssetAspect,
  type AssetSource,
  type AssetSpec,
  type ImageBackendName,
  type PostProcessStep,
} from '@frontline/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** ADR 0001 §5.1 / ART-BIBLE §6 — masters live outside the shipped asset tree. */
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'art-src');

export interface ImageRequest {
  spec: AssetSpec;
  /** `STYLE_ANCHOR + SUBJECT + FRAMING`, already assembled. */
  prompt: string;
  negative: string;
  seed: number;
  /** `spec.source` — what the backend is asked for, which is not always what ships. */
  width: number;
  height: number;
  alpha: boolean;
  /** On-disk paths of the already-generated style reference masters (ART-PROMPTS §7.3). */
  styleRefPaths: readonly string[];
}

export interface ImageBackend {
  name: ImageBackendName;
  /** Recorded in `provenance.json` so a run is reproducible. */
  model: string;
  /** Licence statement for the licensing register (ART-BIBLE §9). */
  licence: string;
  /** ART-PROMPTS §7.3 — whether `styleRefPaths` actually reach the model. */
  supportsStyleRefs: boolean;
  /** ART-BIBLE §6 — whether the backend can return a genuinely transparent master. */
  supportsAlpha: boolean;
  /** ART-BIBLE §9 — whether re-running the same seed reproduces the file. */
  honorsSeed: boolean;
  generate(req: ImageRequest): Promise<Uint8Array>;
}

export interface Provenance {
  assetKey: string;
  /** The lossless master this record describes. */
  masterFile: string;
  /** The ART-BIBLE §6 delivery file the encode step produces from the master. */
  deliveryFile: string;
  /** What the backend was asked to render — differs from the delivery spec for 14 assets. */
  source: AssetSource;
  /** The declared steps the encode step must apply to turn this master into `deliveryFile`. */
  postProcess: readonly PostProcessStep[];
  backend: ImageBackendName;
  model: string;
  /** `null` when the backend exposes no seed (gpt-image-1) — the asset is then not reproducible. */
  seed: number | null;
  promptSha256: string;
  /** Whether the ART-PROMPTS §7.3 consistency references were passed to the backend. */
  styleRefsApplied: boolean;
  generatedAt: string;
  licence: string;
  /** Flip to `true` only when a human genuinely overpainted the file (ADR 0001 §6.4). */
  humanEdited: false;
}

/* -------------------------------------------------------------------------- */
/* Prompt assembly and paths                                                   */
/* -------------------------------------------------------------------------- */

/** ART-PROMPTS §0: the anchor is never paraphrased, reordered or dropped. */
export function assemblePrompt(spec: AssetSpec): string {
  return [STYLE_ANCHOR, spec.prompt.subject, spec.prompt.framing].join('\n\n');
}

/**
 * The one way a NEGATIVE list is expressed to a model that has no negative-prompt parameter — the
 * gpt-image-1 adapter and every hand-pasted chat-UI route must fold it identically, or two runs of
 * the same asset are two different prompts.
 */
export function foldNegativeIntoProse(prompt: string, negative: string): string {
  return `${prompt}\n\nAvoid entirely: ${negative}`;
}

/**
 * The provenance digest (ADR 0001 §6.4). Hashes the assembled prompt **before** any negative fold,
 * alongside the shared NEGATIVE — so a prompt or negative edit is visible whichever route rendered
 * the asset.
 */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(`${prompt}\n--- negative ---\n${NEGATIVE}`).digest('hex');
}

/** Masters are always lossless PNG, whatever the delivery format is (ART-BIBLE §6). */
export function masterOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, `${spec.key}.png`);
}

export function provenanceOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, `${spec.key}.provenance.json`);
}

export function buildImageRequest(spec: AssetSpec, outDir: string): ImageRequest {
  return {
    spec,
    prompt: assemblePrompt(spec),
    negative: NEGATIVE,
    seed: spec.seed,
    width: spec.source.width,
    height: spec.source.height,
    alpha: spec.source.alpha,
    styleRefPaths: spec.styleRefs.map((key) => {
      const ref = findAssetSpec(key);
      if (!ref) throw new Error(`${spec.key} references unknown style ref "${key}"`);
      return masterOutputPath(outDir, ref);
    }),
  };
}

export function buildProvenance(
  spec: AssetSpec,
  backend: ImageBackend,
  request: ImageRequest,
  generatedAt: Date,
): Provenance {
  return {
    assetKey: spec.key,
    masterFile: `${spec.key}.png`,
    deliveryFile: spec.file,
    source: spec.source,
    postProcess: spec.postProcess,
    backend: backend.name,
    model: backend.model,
    seed: backend.honorsSeed ? spec.seed : null,
    promptSha256: hashPrompt(request.prompt),
    styleRefsApplied: backend.supportsStyleRefs && request.styleRefPaths.length > 0,
    generatedAt: generatedAt.toISOString(),
    licence: backend.licence,
    humanEdited: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Backends                                                                    */
/* -------------------------------------------------------------------------- */

export type Env = Readonly<Partial<Record<string, string>>>;

/** Per-asset override wins (ADR 0001 §6.6), otherwise `FRONTLINE_ART_BACKEND`. */
export function resolveBackendName(spec: AssetSpec, env: Env): ImageBackendName {
  if (spec.backend) return spec.backend;
  const selected = env.FRONTLINE_ART_BACKEND;
  if (!selected) {
    throw new Error(
      'FRONTLINE_ART_BACKEND is unset. Set it to "fal" or "openai", or run with --dry-run.',
    );
  }
  const parsed = ImageBackendNameSchema.safeParse(selected);
  if (!parsed.success) throw new Error(`Unknown FRONTLINE_ART_BACKEND "${selected}"`);
  return parsed.data;
}

export function createBackend(name: ImageBackendName, env: Env): ImageBackend {
  return name === 'fal' ? createFalBackend(env) : createOpenAiBackend(env);
}

function requireKey(env: Env, variable: string, backend: string): string {
  const key = env[variable];
  if (!key) throw new Error(`${variable} is unset — required by the "${backend}" backend`);
  return key;
}

const FalResponseSchema = z.object({ images: z.array(z.object({ url: z.string() })).min(1) });

/**
 * fal.ai FLUX.2 [pro] — the recommended default (ADR 0001 §6.6).
 *
 * The endpoint, model id and field names below follow fal's documented queue/sync conventions but
 * were **not** exercised against the live API (no account, no key, nothing spent). Treat the first
 * real run as the verification step; `FRONTLINE_FAL_MODEL` exists so a drift is a config change.
 */
export function createFalBackend(env: Env): ImageBackend {
  const model = env.FRONTLINE_FAL_MODEL ?? 'fal-ai/flux-2/pro';
  return {
    name: 'fal',
    model,
    licence: 'fal.ai — commercial use per the model page (ADR 0001 §6.1); output rights per §6.4',
    supportsStyleRefs: true,
    supportsAlpha: BACKEND_CAPABILITIES.fal.alpha,
    honorsSeed: true,
    async generate(req) {
      assertProducible('fal', req);
      const key = requireKey(env, 'FAL_KEY', 'fal');
      const styleRefs = await Promise.all(req.styleRefPaths.map(toDataUri));
      const response = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt,
          negative_prompt: req.negative,
          image_size: { width: req.width, height: req.height },
          seed: req.seed,
          // ART-PROMPTS §0.3 asks for 3 candidates (5 for portraits) and ADR 0001 §6.5 budgets on
          // that basis. We request one: picking among candidates needs a human review loop that
          // does not exist yet. Raising this is a budget decision, not a code decision.
          num_images: 1,
          num_inference_steps: GENERATION_SETTINGS.steps,
          guidance_scale: GENERATION_SETTINGS.guidanceScale,
          // Masters are lossless; the ART-BIBLE §6 WebP is produced by the encode step.
          output_format: 'png',
          ...(styleRefs.length > 0 ? { image_urls: styleRefs } : {}),
        }),
      });
      const { images } = FalResponseSchema.parse(await readJson(response, 'fal'));
      return fetchBytes(images[0]!.url);
    },
  };
}

const OpenAiResponseSchema = z.object({ data: z.array(z.object({ b64_json: z.string() })).min(1) });

/** The sizes gpt-image-1 accepts, per OpenAI's images API. Anything else is rejected server-side. */
export type OpenAiSize = '1024x1024' | '1024x1536' | '1536x1024';

/**
 * OpenAI gpt-image-1 — used for the four overseer portraits (ADR 0001 §6.6).
 *
 * gpt-image-1 exposes neither a seed nor a negative prompt, so reproducibility is weaker than fal
 * (`honorsSeed: false`) and the negative list is folded into the prompt. Style references go
 * through the images **edit** endpoint, which is how ART-PROMPTS §7.3 says to carry them. Request
 * shape follows OpenAI's documented images API; like the fal adapter it has **not** been exercised
 * against the live API.
 */
export function createOpenAiBackend(env: Env): ImageBackend {
  const model = 'gpt-image-1';
  return {
    name: 'openai',
    model,
    licence: 'OpenAI gpt-image-1 — output ownership unresolved, see ADR 0001 §6.4',
    supportsStyleRefs: true,
    supportsAlpha: BACKEND_CAPABILITIES.openai.alpha,
    honorsSeed: false,
    async generate(req) {
      assertProducible('openai', req);
      const key = requireKey(env, 'OPENAI_API_KEY', 'openai');
      // Unreachable while the size table and the capability table agree — pinned by a test.
      const size = openAiSize(req.width, req.height);
      if (size === null) throw new Error(unproducibleMessage('openai', requestSource(req)));

      const prompt = foldNegativeIntoProse(req.prompt, req.negative);
      const background = req.alpha ? 'transparent' : 'opaque';
      const response =
        req.styleRefPaths.length > 0
          ? await openAiEdit(key, model, prompt, size, background, req.styleRefPaths)
          : await openAiGenerate(key, model, prompt, size, background);

      const { data } = OpenAiResponseSchema.parse(await readJson(response, 'openai'));
      return new Uint8Array(Buffer.from(data[0]!.b64_json, 'base64'));
    },
  };
}

/** `background: transparent` is only honoured alongside a png/webp `output_format`. */
type OpenAiBackground = 'transparent' | 'opaque';

async function openAiGenerate(
  key: string,
  model: string,
  prompt: string,
  size: OpenAiSize,
  background: OpenAiBackground,
): Promise<Response> {
  return fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality: 'high',
      background,
      output_format: 'png',
      n: 1,
    }),
  });
}

/** ART-PROMPTS §7.3 — the two approved references are passed as `image[]` edit inputs. */
async function openAiEdit(
  key: string,
  model: string,
  prompt: string,
  size: OpenAiSize,
  background: OpenAiBackground,
  styleRefPaths: readonly string[],
): Promise<Response> {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', 'high');
  form.append('background', background);
  form.append('output_format', 'png');
  form.append('n', '1');
  for (const refPath of styleRefPaths) {
    const bytes = await readFile(refPath);
    form.append('image[]', new Blob([bytes], { type: 'image/png' }), path.basename(refPath));
  }
  return fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
}

/** The gpt-image-1 size for a manifest resolution, or `null` when it cannot produce one. */
export function openAiSize(width: number, height: number): OpenAiSize | null {
  if (width === 1024 && height === 1024) return '1024x1024';
  if (width === 1024 && height === 1536) return '1024x1536';
  if (width === 1536 && height === 1024) return '1536x1024';
  return null;
}

/** What a request asks the backend for, in the shape the capability table speaks. */
function requestSource(req: ImageRequest): AssetSource {
  return { width: req.width, height: req.height, alpha: req.alpha };
}

function describeSource({ width, height, alpha }: AssetSource): string {
  return `${width}×${height}${alpha ? ' with alpha' : ''}`;
}

/** Puts {@link BACKEND_CAPABILITIES}' verdict into words. Only meaningful when it is a refusal. */
function unproducibleMessage(backend: ImageBackendName, source: AssetSource): string {
  const { sizes, alpha } = BACKEND_CAPABILITIES[backend];
  const supported = sizes === null ? 'any size' : sizes.map(([w, h]) => `${w}×${h}`).join(', ');
  return `${backend} cannot render ${describeSource(source)} — it supports ${supported}, ${alpha ? 'with' : 'no'} alpha`;
}

/**
 * Why a backend cannot render `source`, or `null` when it can. {@link backendCanProduce} owns the
 * decision so there is exactly one capability table; this only explains it. Silently substituting a
 * size or dropping alpha would manufacture an ART-BIBLE §10 rejection at cost, so every caller
 * refuses instead — in `--dry-run` before the money, and in the adapters as a last line.
 */
export function unproducibleSource(backend: ImageBackendName, source: AssetSource): string | null {
  return backendCanProduce(backend, source) ? null : unproducibleMessage(backend, source);
}

function assertProducible(backend: ImageBackendName, req: ImageRequest): void {
  const problem = unproducibleSource(backend, requestSource(req));
  if (problem !== null) throw new Error(problem);
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * `output_format: 'png'` is unverified wire format on both backends. If a provider ignores or
 * renames it we would write a JPEG into `<key>.png` and only find out when the encode step chokes,
 * long after the run is paid for — so the master's own bytes are the source of truth.
 */
export function assertPngMaster(key: string, bytes: Uint8Array): void {
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(
      `${key}: backend returned non-PNG bytes — masters must be lossless PNG (ART-BIBLE §6)`,
    );
  }
}

/** Error bodies name the offending field — the only diagnostic an unverified wire format has. */
async function describeFailure(response: Response, backend: string): Promise<Error> {
  const body = (await response.text().catch(() => '')).trim().slice(0, 500);
  return new Error(
    `${backend} request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
  );
}

async function readJson(response: Response, backend: string): Promise<unknown> {
  if (!response.ok) throw await describeFailure(response, backend);
  return response.json();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw await describeFailure(response, 'image download');
  return new Uint8Array(await response.arrayBuffer());
}

async function toDataUri(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface CliOptions {
  dryRun: boolean;
  /** Print the assembled prompts as JSON instead of rendering anything. */
  emitPrompts: boolean;
  outDir: string;
  /** Asset keys to generate; empty means the whole manifest. */
  only: readonly string[];
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options = {
    dryRun: false,
    emitPrompts: false,
    outDir: DEFAULT_OUT_DIR,
    only: [] as string[],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--emit-prompts') {
      options.emitPrompts = true;
    } else if (arg === '--out' || arg === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--out') options.outDir = path.resolve(value);
      else options.only.push(...parseOnlyKeys(value));
      i += 1;
    } else {
      throw new Error(
        `Unknown argument "${arg}". Usage: gen-art [--dry-run] [--emit-prompts] [--out DIR] [--only KEYS]`,
      );
    }
  }
  return options;
}

/**
 * An empty list means "the whole manifest" only when `--only` is absent. `--only "$KEY"` with an
 * unset shell variable must not silently become a funded run over all 44 assets, so an explicit
 * `--only` that names no key fails the same way an unknown key does.
 */
function parseOnlyKeys(value: string): string[] {
  const keys = value.split(',').filter(Boolean);
  if (keys.length === 0) throw new Error(`--only selected no asset keys, got "${value}"`);
  return keys;
}

export function selectSpecs(only: readonly string[]): readonly AssetSpec[] {
  if (only.length === 0) return ART_MANIFEST;
  return only.map((key) => {
    const spec = findAssetSpec(key);
    if (!spec) throw new Error(`Unknown asset key "${key}"`);
    return spec;
  });
}

/**
 * ART-PROMPTS §7.1 — plates and planes first (they set the world's value key), then the two assets
 * that become the style references, then everything that depends on them. Stable within each tier.
 */
export function orderForGeneration(specs: readonly AssetSpec[]): readonly AssetSpec[] {
  const tier = (spec: AssetSpec): number => {
    if (spec.styleRefs.length > 0) return 2;
    return (STYLE_REFERENCE_KEYS as readonly string[]).includes(spec.key) ? 1 : 0;
  };
  return [...specs].sort((a, b) => tier(a) - tier(b));
}

/** One `--emit-prompts` record: everything a hand- or robot-driven chat UI needs to render an asset. */
export interface EmittedPrompt {
  key: string;
  /** The exact prose to paste — `assemblePrompt` with NEGATIVE folded in, never a paraphrase. */
  prompt: string;
  /** `spec.source` — what to ask the UI for, which is not always what ships. */
  width: number;
  height: number;
  /** `spec.aspect`; `validateAssetSpec` pins the source to the delivery ratio, so it covers both. */
  aspect: AssetAspect;
  alpha: boolean;
  seed: number;
  /** Identical to what {@link buildProvenance} records, so a pasted asset's provenance still matches. */
  promptSha256: string;
}

/**
 * ART-PROMPTS §0 — a chat UI has neither a negative-prompt field nor a seed, so the negative is
 * folded into the prose exactly as the gpt-image-1 adapter folds it and the seed travels as data.
 */
export function emitPrompt(spec: AssetSpec): EmittedPrompt {
  const prompt = assemblePrompt(spec);
  return {
    key: spec.key,
    prompt: foldNegativeIntoProse(prompt, NEGATIVE),
    width: spec.source.width,
    height: spec.source.height,
    aspect: spec.aspect,
    alpha: spec.source.alpha,
    seed: spec.seed,
    promptSha256: hashPrompt(prompt),
  };
}

/**
 * Everything `--dry-run` checks: manifest legality, prompt assembly, output paths and backend
 * selectability. Returns one line per problem; empty means the run would be safe.
 */
export function validateRun(specs: readonly AssetSpec[], outDir: string, env: Env): string[] {
  const problems: string[] = [];
  const seenPaths = new Map<string, string>();

  for (const spec of specs) {
    for (const problem of validateAssetSpec(spec)) problems.push(`${spec.key}: ${problem}`);

    const outPath = masterOutputPath(outDir, spec);
    const claimedBy = seenPaths.get(outPath);
    if (claimedBy) problems.push(`${spec.key}: output path collides with ${claimedBy}`);
    seenPaths.set(outPath, spec.key);

    try {
      const request = buildImageRequest(spec, outDir);
      if (!request.prompt.startsWith(STYLE_ANCHOR)) {
        problems.push(`${spec.key}: assembled prompt does not start with the style anchor`);
      }
      if (!request.prompt.includes(spec.prompt.subject)) {
        problems.push(`${spec.key}: assembled prompt is missing its subject block`);
      }
    } catch (error) {
      problems.push(`${spec.key}: ${errorMessage(error)}`);
    }

    // Backend selection is a dry-run concern; credentials are not (they are never needed offline).
    const selected = spec.backend ?? env.FRONTLINE_ART_BACKEND;
    if (selected === undefined) {
      // Otherwise the run starts, bills for every pinned asset it reaches, and only then throws.
      problems.push(
        `${spec.key}: not pinned to a backend and FRONTLINE_ART_BACKEND is unset — set it to "fal" or "openai"`,
      );
      continue;
    }
    const parsed = ImageBackendNameSchema.safeParse(selected);
    if (!parsed.success) {
      problems.push(`${spec.key}: unknown FRONTLINE_ART_BACKEND "${selected}"`);
      continue;
    }
    // The guard runs against `spec.source` — the thing the backend is actually asked for.
    const unproducible = unproducibleSource(parsed.data, spec.source);
    if (unproducible !== null) problems.push(`${spec.key}: ${unproducible}`);
  }

  return problems;
}

/**
 * ART-PROMPTS §7.3 refs must exist before the asset that cites them. Checked up front so a
 * `--only` run fails for free instead of ENOENT-ing partway through a paid one.
 */
async function assertStyleRefsAvailable(
  specs: readonly AssetSpec[],
  outDir: string,
): Promise<void> {
  const generated = new Set<string>();
  for (const spec of specs) {
    for (const key of spec.styleRefs) {
      if (generated.has(key)) continue;
      const ref = findAssetSpec(key);
      if (!ref) throw new Error(`${spec.key}: unknown style ref "${key}"`);
      const refPath = masterOutputPath(outDir, ref);
      if (!(await fileExists(refPath))) {
        throw new Error(
          `${spec.key}: style ref ${key} has not been generated yet (expected ${refPath})`,
        );
      }
    }
    generated.add(spec.key);
  }
}

export async function generate(
  specs: readonly AssetSpec[],
  outDir: string,
  env: Env,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await assertStyleRefsAvailable(specs, outDir);
  const backends = new Map<ImageBackendName, ImageBackend>();

  for (const spec of specs) {
    const name = resolveBackendName(spec, env);
    const backend = backends.get(name) ?? createBackend(name, env);
    backends.set(name, backend);

    const request = buildImageRequest(spec, outDir);
    if (request.styleRefPaths.length > 0 && !backend.supportsStyleRefs) {
      process.stderr.write(
        `warning: ${spec.key} generated without its style references — ${backend.name} cannot carry them\n`,
      );
    }

    const masterPath = masterOutputPath(outDir, spec);
    process.stdout.write(`generating ${path.basename(masterPath)} via ${backend.name}\n`);
    const bytes = await backend.generate(request);
    assertPngMaster(spec.key, bytes);

    await writeFile(masterPath, bytes);
    await writeFile(
      provenanceOutputPath(outDir, spec),
      `${JSON.stringify(buildProvenance(spec, backend, request, new Date()), null, 2)}\n`,
    );
  }
}

export async function main(argv: readonly string[], env: Env): Promise<number> {
  let options: CliOptions;
  let specs: readonly AssetSpec[];
  try {
    options = parseArgs(argv);
    specs = orderForGeneration(selectSpecs(options.only));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  // Before `validateRun`: a chat UI is not one of the two backends, so the selectability gate has
  // nothing to say here — and this mode must run on a machine holding no credentials at all.
  if (options.emitPrompts) {
    process.stdout.write(`${JSON.stringify(specs.map(emitPrompt), null, 2)}\n`);
    return 0;
  }

  const problems = validateRun(specs, options.outDir, env);
  if (problems.length > 0) {
    process.stderr.write(`${problems.length} manifest problem(s):\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    return 1;
  }

  if (options.dryRun) {
    process.stdout.write(`${specs.length} asset(s) validated, no network calls made:\n`);
    for (const spec of specs) {
      process.stdout.write(
        `  ${masterOutputPath(options.outDir, spec)}  ${resolveBackendName(spec, env)}  seed ${spec.seed} → ${spec.file}${describePostProcess(spec)}\n`,
      );
    }
    // Most of these pins are capability-forced rather than chosen, and they move the bill several
    // times over — the gate that runs before the money is the place to say which backend gets what.
    process.stdout.write(
      `backends: ${tally(specs.map((spec) => resolveBackendName(spec, env)))}\n`,
    );
    process.stdout.write(postProcessSummary(specs));
    return 0;
  }

  try {
    await generate(specs, options.outDir, env);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  process.stdout.write(postProcessSummary(specs));
  return 0;
}

/** `name count, name count` — used for both the backend split and the post-process split. */
function tally(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => `${value} ${count}`).join(', ');
}

/** Makes a master that is not yet the delivery image visible in the dry-run listing. */
function describePostProcess(spec: AssetSpec): string {
  if (spec.postProcess.length === 0) return '';
  return `  [rendered ${describeSource(spec.source)}, then ${spec.postProcess.join(' + ')}]`;
}

/**
 * Printed on both paths, because a paid run otherwise ends with 44 "generating …" lines and no hint
 * that 14 of the masters are not the assets — and this runner never produces a delivery file.
 */
function postProcessSummary(specs: readonly AssetSpec[]): string {
  const pending = specs.filter((spec) => spec.postProcess.length > 0);
  if (pending.length === 0) return '';
  const steps = tally(pending.flatMap((spec) => spec.postProcess));
  return (
    `${pending.length} master(s) are not the delivery image (${steps}).\n` +
    `Run \`pnpm --filter @frontline/scripts encode-art\` to apply these — until it has run, those ` +
    `delivery files do not exist.\n`
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
