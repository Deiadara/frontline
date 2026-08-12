/**
 * Manifest-driven art generation (ADR 0001 §6, docs/ART-PROMPTS.md).
 *
 * Every asset is described once, in `@frontline/shared`'s `ART_MANIFEST`. This runner assembles
 * `STYLE_ANCHOR + SUBJECT + FRAMING` for each entry, hands it to a pluggable {@link ImageBackend},
 * writes the bytes under the manifest filename and drops a `*.provenance.json` beside it.
 *
 *   pnpm --filter @frontline/scripts gen-art -- --dry-run
 *   FRONTLINE_ART_BACKEND=fal FAL_KEY=… pnpm --filter @frontline/scripts gen-art
 *
 * `--dry-run` makes **zero** network calls and is what CI exercises; it exits non-zero on any
 * validation failure. No backend is activated by default — see ADR 0001 §6.2 for why there is
 * deliberately no key-free route.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  findAssetSpec,
  validateAssetSpec,
  type AssetSpec,
  type ImageBackendName,
} from '@frontline/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** ADR 0001 §5.1 — the asset tree AssetPack packs from. */
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'assets');

export interface ImageRequest {
  spec: AssetSpec;
  /** `STYLE_ANCHOR + SUBJECT + FRAMING`, already assembled. */
  prompt: string;
  negative: string;
  seed: number;
  width: number;
  height: number;
  /** On-disk paths of the already-generated style reference images (ART-PROMPTS §7.3). */
  styleRefPaths: readonly string[];
}

export interface ImageBackend {
  name: ImageBackendName;
  /** Recorded in `provenance.json` so a run is reproducible. */
  model: string;
  /** Licence statement for the licensing register (ART-BIBLE §9). */
  licence: string;
  generate(req: ImageRequest): Promise<Uint8Array>;
}

export interface Provenance {
  assetKey: string;
  file: string;
  backend: ImageBackendName;
  model: string;
  seed: number;
  promptSha256: string;
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

export function assetOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, spec.file);
}

export function provenanceOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, `${spec.file.replace(/\.[^.]+$/, '')}.provenance.json`);
}

export function buildImageRequest(spec: AssetSpec, outDir: string): ImageRequest {
  return {
    spec,
    prompt: assemblePrompt(spec),
    negative: NEGATIVE,
    seed: spec.seed,
    width: spec.width,
    height: spec.height,
    styleRefPaths: spec.styleRefs.map((key) => {
      const ref = findAssetSpec(key);
      if (!ref) throw new Error(`${spec.key} references unknown style ref "${key}"`);
      return assetOutputPath(outDir, ref);
    }),
  };
}

export function buildProvenance(
  spec: AssetSpec,
  backend: ImageBackend,
  prompt: string,
  generatedAt: Date,
): Provenance {
  return {
    assetKey: spec.key,
    file: spec.file,
    backend: backend.name,
    model: backend.model,
    seed: spec.seed,
    promptSha256: createHash('sha256')
      .update(`${prompt}\n--- negative ---\n${NEGATIVE}`)
      .digest('hex'),
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
    async generate(req) {
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
          num_images: 1,
          num_inference_steps: GENERATION_SETTINGS.steps,
          guidance_scale: GENERATION_SETTINGS.guidanceScale,
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
 * and the negative list is folded into the prompt. Request shape follows OpenAI's documented images
 * API; like the fal adapter it has **not** been exercised against the live API.
 */
export function createOpenAiBackend(env: Env): ImageBackend {
  return {
    name: 'openai',
    model: 'gpt-image-1',
    licence: 'OpenAI gpt-image-1 — output ownership unresolved, see ADR 0001 §6.4',
    async generate(req) {
      const key = requireKey(env, 'OPENAI_API_KEY', 'openai');
      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: `${req.prompt}\n\nAvoid entirely: ${req.negative}`,
          size: openAiSize(req.width, req.height),
          quality: 'high',
          n: 1,
        }),
      });
      const { data } = OpenAiResponseSchema.parse(await readJson(response, 'openai'));
      return Buffer.from(data[0]!.b64_json, 'base64');
    },
  };
}

/** Maps a manifest resolution onto the closest supported gpt-image-1 size. */
export function openAiSize(width: number, height: number): OpenAiSize {
  if (width === height) return '1024x1024';
  return width < height ? '1024x1536' : '1536x1024';
}

async function readJson(response: Response, backend: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${backend} request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download image: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function toDataUri(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const mime = filePath.endsWith('.png') ? 'image/png' : 'image/webp';
  return `data:${mime};base64,${bytes.toString('base64')}`;
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
 * Everything `--dry-run` checks: manifest legality, prompt assembly, output paths and backend
 * selectability. Returns one line per problem; empty means the run would be safe.
 */
export function validateRun(specs: readonly AssetSpec[], outDir: string, env: Env): string[] {
  const problems: string[] = [];
  const seenPaths = new Map<string, string>();

  for (const spec of specs) {
    for (const problem of validateAssetSpec(spec)) problems.push(`${spec.key}: ${problem}`);

    const outPath = assetOutputPath(outDir, spec);
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
    if (spec.backend === undefined && env.FRONTLINE_ART_BACKEND !== undefined) {
      const parsed = ImageBackendNameSchema.safeParse(env.FRONTLINE_ART_BACKEND);
      if (!parsed.success) {
        problems.push(`${spec.key}: unknown FRONTLINE_ART_BACKEND "${env.FRONTLINE_ART_BACKEND}"`);
      }
    }
  }

  return problems;
}

async function generate(specs: readonly AssetSpec[], outDir: string, env: Env): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const backends = new Map<ImageBackendName, ImageBackend>();

  for (const spec of specs) {
    const name = resolveBackendName(spec, env);
    const backend = backends.get(name) ?? createBackend(name, env);
    backends.set(name, backend);

    const request = buildImageRequest(spec, outDir);
    process.stdout.write(`generating ${spec.file} via ${backend.name} (seed ${spec.seed})\n`);
    const bytes = await backend.generate(request);

    await writeFile(assetOutputPath(outDir, spec), bytes);
    await writeFile(
      provenanceOutputPath(outDir, spec),
      `${JSON.stringify(buildProvenance(spec, backend, request.prompt, new Date()), null, 2)}\n`,
    );
  }
}

export async function main(argv: readonly string[], env: Env): Promise<number> {
  let options: CliOptions;
  let specs: readonly AssetSpec[];
  try {
    options = parseArgs(argv);
    specs = selectSpecs(options.only);
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
      process.stdout.write(`  ${assetOutputPath(options.outDir, spec)}  seed ${spec.seed}\n`);
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
