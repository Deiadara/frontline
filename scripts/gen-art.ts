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
 *   pnpm --filter @frontline/scripts gen-art -- --dry-run
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
  GENERATION_SETTINGS,
  ImageBackendNameSchema,
  NEGATIVE,
  STYLE_ANCHOR,
  STYLE_REFERENCE_KEYS,
  findAssetSpec,
  validateAssetSpec,
  type AssetSpec,
  type ImageBackendName,
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
  width: number;
  height: number;
  /** ART-BIBLE §6 — whether the master must carry a real alpha channel. */
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
    width: spec.width,
    height: spec.height,
    alpha: spec.alpha,
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
    backend: backend.name,
    model: backend.model,
    seed: backend.honorsSeed ? spec.seed : null,
    promptSha256: createHash('sha256')
      .update(`${request.prompt}\n--- negative ---\n${NEGATIVE}`)
      .digest('hex'),
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

/**
 * ART-BIBLE §6 — which backends can return a master with a real alpha channel. 26 of the 44 assets
 * need one, and prose in the FRAMING block is not a transparency parameter, so this is capability
 * data rather than a hope.
 */
const BACKEND_SUPPORTS_ALPHA: Readonly<Record<ImageBackendName, boolean>> = {
  // gpt-image-1 documents `background: transparent`, which requires a png/webp `output_format`.
  openai: true,
  // FLUX.2 [pro] documents no transparency, alpha or background parameter — it mattes the subject.
  fal: false,
};

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
    supportsAlpha: BACKEND_SUPPORTS_ALPHA.fal,
    honorsSeed: true,
    async generate(req) {
      if (req.alpha) throw new Error(unsupportedTransparencyMessage('fal'));
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
    supportsAlpha: BACKEND_SUPPORTS_ALPHA.openai,
    honorsSeed: false,
    async generate(req) {
      const key = requireKey(env, 'OPENAI_API_KEY', 'openai');
      const size = openAiSize(req.width, req.height);
      if (size === null) throw new Error(unsupportedResolutionMessage(req.width, req.height));

      const prompt = `${req.prompt}\n\nAvoid entirely: ${req.negative}`;
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

function unsupportedResolutionMessage(width: number, height: number): string {
  return `gpt-image-1 cannot produce ${width}×${height} (supported: 1024×1024, 1024×1536, 1536×1024)`;
}

/**
 * Why a backend cannot deliver a spec at its manifest resolution, or `null` when it can. Silently
 * substituting a size would manufacture an ART-BIBLE §10 rejection at cost, so this is a
 * `--dry-run` failure instead.
 */
export function unsupportedResolution(
  backend: ImageBackendName,
  width: number,
  height: number,
): string | null {
  if (backend === 'openai' && openAiSize(width, height) === null) {
    return unsupportedResolutionMessage(width, height);
  }
  return null;
}

function unsupportedTransparencyMessage(backend: ImageBackendName): string {
  return `${backend} cannot deliver an alpha channel — this asset must ship transparent (ART-BIBLE §6)`;
}

/**
 * Why a backend cannot deliver a spec's transparency, or `null` when it can. Same contract as
 * {@link unsupportedResolution}: an opaque master for an alpha asset is an ART-BIBLE §10 rejection
 * that only shows up after the money is spent, so it fails `--dry-run` instead.
 */
export function unsupportedTransparency(backend: ImageBackendName, alpha: boolean): string | null {
  return alpha && !BACKEND_SUPPORTS_ALPHA[backend] ? unsupportedTransparencyMessage(backend) : null;
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
  outDir: string;
  /** Asset keys to generate; empty means the whole manifest. */
  only: readonly string[];
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options = { dryRun: false, outDir: DEFAULT_OUT_DIR, only: [] as string[] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--out' || arg === '--only') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      if (arg === '--out') options.outDir = path.resolve(value);
      else options.only.push(...value.split(',').filter(Boolean));
      i += 1;
    } else {
      throw new Error(
        `Unknown argument "${arg}". Usage: gen-art [--dry-run] [--out DIR] [--only KEYS]`,
      );
    }
  }
  return options;
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
    if (selected !== undefined) {
      const parsed = ImageBackendNameSchema.safeParse(selected);
      if (!parsed.success) {
        problems.push(`${spec.key}: unknown FRONTLINE_ART_BACKEND "${selected}"`);
      } else {
        const unsupported = [
          unsupportedResolution(parsed.data, spec.width, spec.height),
          unsupportedTransparency(parsed.data, spec.alpha),
        ];
        for (const problem of unsupported) {
          if (problem !== null) problems.push(`${spec.key}: ${problem}`);
        }
      }
    }
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
        `  ${masterOutputPath(options.outDir, spec)}  seed ${spec.seed} → ${spec.file}\n`,
      );
    }
    return 0;
  }

  try {
    await generate(specs, options.outDir, env);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  return 0;
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
