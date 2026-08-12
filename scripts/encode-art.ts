/**
 * The encode stage (ADR 0001 §4.1): master → ART-BIBLE §6 delivery file.
 *
 * `scripts/gen-art.ts` writes a lossless PNG **master** per asset into `art-src/`. For 14 of the 44
 * assets that master is deliberately not the delivery image — no backend renders 512×512 with alpha
 * and none renders 16:9 with alpha at all — so the manifest declares `spec.postProcess`, the steps
 * that close the gap. This runner is what applies them, then encodes the result as `spec.file`
 * (WebP at `ASSET_CLASS_SPECS[class].quality`, or lossless PNG) into the `assets/` drop directory.
 *
 *   pnpm --filter @frontline/scripts encode-art --dry-run
 *   pnpm --filter @frontline/scripts encode-art --only icon-alloy
 *
 * (No `--` separator: pnpm 11 forwards it to the script, where it parses as an unknown argument.)
 *
 * A declared step with no implementation is a hard failure, never a pass-through: shipping an
 * un-downscaled icon or an opaque "transparent" plane is an ART-BIBLE §10 rejection that would
 * otherwise only surface in the browser, long after the generation run is paid for.
 *
 * This is the §4.1 stage implemented directly on `sharp` rather than through `@assetpack/core`.
 * AssetPack's value is atlas packing and manifest emission; we already have a hand-written typed
 * manifest in `@frontline/shared` and `apps/client/src/assets/source.ts` globs `assets/` for
 * delivery files. Adopting AssetPack to get a resize would mean adopting its manifest too.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp, { type Sharp } from 'sharp';
import {
  ART_MANIFEST,
  ASSET_CLASS_SPECS,
  POST_PROCESS_STEPS,
  findAssetSpec,
  validateAssetSpec,
  type AssetSpec,
  type PostProcessStep,
} from '@frontline/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where `gen-art.ts` leaves its masters (ADR 0001 §5.1). Never shipped. */
export const DEFAULT_MASTER_DIR = path.join(REPO_ROOT, 'art-src');
/** The drop directory the client globs — see `assets/README.md`. */
export const DEFAULT_ASSET_DIR = path.join(REPO_ROOT, 'assets');

/* -------------------------------------------------------------------------- */
/* Raster primitives                                                           */
/* -------------------------------------------------------------------------- */

/** Straight (non-premultiplied) 8-bit RGBA — the working form every step operates on. */
export interface RgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

const CHANNELS = 4;

function sharpFrom(image: RgbaImage): Sharp {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: CHANNELS },
  });
}

async function toRgba(pipeline: Sharp): Promise<RgbaImage> {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function decodeMaster(bytes: Uint8Array): Promise<RgbaImage> {
  return toRgba(sharp(bytes));
}

/**
 * The fraction of the image that is transparent, weighted by coverage — a half-opaque pixel counts
 * as half. Weighted rather than counted so a feathered human matte and a hard automatic one are
 * measured on the same scale by the ART-BIBLE §6 gate.
 */
export function transparencyOf(image: RgbaImage): number {
  let opacity = 0;
  for (let i = CHANNELS - 1; i < image.data.length; i += CHANNELS) opacity += image.data[i]!;
  return 1 - opacity / (255 * image.width * image.height);
}

/* -------------------------------------------------------------------------- */
/* Post-process steps                                                          */
/* -------------------------------------------------------------------------- */

/** Per-channel Chebyshev distance inside which a pixel counts as the keyed background. */
export const DEFAULT_MATTE_TOLERANCE = 18;

/**
 * Transparency at or above which a master is taken to be matted already, so {@link matte} leaves it
 * alone. This is the ADR 0001 §6.4 human-pass route: hand-cut `plane-city-fore.png` into `art-src/`
 * and the encode step keeps that alpha instead of keying over it. The §6 gate still applies.
 */
export const HUMAN_MATTE_FLOOR = 0.01;

export interface EncodeOptions {
  matteTolerance: number;
}

export const DEFAULT_ENCODE_OPTIONS: EncodeOptions = { matteTolerance: DEFAULT_MATTE_TOLERANCE };

export type PostProcessor = (
  image: RgbaImage,
  spec: AssetSpec,
  options: EncodeOptions,
) => Promise<RgbaImage>;

/** Channel bits kept when histogramming for the background colour — 16 levels per channel. */
const HISTOGRAM_BITS = 4;

/**
 * The share of the canvas a matching region must cover before it is taken to be background. Small
 * patches that merely happen to match — a sky-coloured window light, a rim highlight — survive.
 */
export const MIN_KEYED_REGION = 0.005;

/**
 * The master's dominant colour: the mean of the fullest bucket of a quantised RGB histogram.
 *
 * The backends cannot render alpha, so asked for a "transparent background" they paint a large flat
 * field instead. That field is by far the most common colour in the frame, wherever it sits — which
 * is the point: `plane-city-far` is transparent along the **top**, `plane-city-fore` through its
 * **centre**, so nothing may assume the background touches any particular edge.
 */
function backgroundColour(image: RgbaImage): [number, number, number] {
  const { data } = image;
  const shift = 8 - HISTOGRAM_BITS;
  const bucketOf = (offset: number): number =>
    ((data[offset]! >> shift) << (HISTOGRAM_BITS * 2)) |
    ((data[offset + 1]! >> shift) << HISTOGRAM_BITS) |
    (data[offset + 2]! >> shift);

  const counts = new Int32Array(1 << (HISTOGRAM_BITS * 3));
  for (let offset = 0; offset < data.length; offset += CHANNELS) {
    const bucket = bucketOf(offset);
    counts[bucket] = counts[bucket]! + 1;
  }

  let peak = 0;
  for (let bucket = 1; bucket < counts.length; bucket += 1) {
    if (counts[bucket]! > counts[peak]!) peak = bucket;
  }

  const sums = [0, 0, 0];
  for (let offset = 0; offset < data.length; offset += CHANNELS) {
    if (bucketOf(offset) !== peak) continue;
    for (let c = 0; c < 3; c += 1) sums[c]! += data[offset + c]!;
  }
  return sums.map((sum) => Math.round(sum / counts[peak]!)) as [number, number, number];
}

/**
 * Cuts an alpha channel out of an opaque master by clearing every **contiguous region** of the
 * background colour that covers at least {@link MIN_KEYED_REGION} of the canvas.
 *
 * Connectivity is what makes this safe to run unattended: a window light or a rim highlight that
 * happens to sit within `tolerance` of the sky is its own tiny region and survives, while the flat
 * field the backend painted in place of transparency goes, wherever in the frame it sits.
 *
 * Matching is against the seed colour, never a pixel's neighbour — chained tolerance walks a
 * gradient and would quietly eat the artwork. A master whose background is not flat therefore keys
 * badly on purpose and fails the ART-BIBLE §6 gate rather than shipping a hole in the city.
 *
 * The mask is binary. Edge feathering is a human-pass concern, not something to fake here.
 */
export function keyBackground(image: RgbaImage, tolerance: number): RgbaImage {
  const { data, width, height } = image;
  const [seedR, seedG, seedB] = backgroundColour(image);
  const pixels = width * height;

  const matchesSeed = (pixel: number): boolean => {
    const offset = pixel * CHANNELS;
    return (
      Math.abs(data[offset]! - seedR) <= tolerance &&
      Math.abs(data[offset + 1]! - seedG) <= tolerance &&
      Math.abs(data[offset + 2]! - seedB) <= tolerance
    );
  };

  // Region id per pixel: 0 means "does not match the background colour".
  const region = new Int32Array(pixels);
  const sizes: number[] = [0];
  const stack = new Int32Array(pixels);

  for (let seed = 0; seed < pixels; seed += 1) {
    if (region[seed] !== 0 || !matchesSeed(seed)) continue;
    const id = sizes.length;
    let size = 0;
    let top = 1;
    region[seed] = id;
    stack[0] = seed;

    while (top > 0) {
      top -= 1;
      const pixel = stack[top]!;
      size += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      const visit = (neighbour: number): void => {
        if (region[neighbour] !== 0 || !matchesSeed(neighbour)) return;
        // Claimed at push time, so every pixel enters the stack at most once.
        region[neighbour] = id;
        stack[top] = neighbour;
        top += 1;
      };
      if (x > 0) visit(pixel - 1);
      if (x < width - 1) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y < height - 1) visit(pixel + width);
    }
    sizes.push(size);
  }

  const keyed = Buffer.from(data);
  const floor = MIN_KEYED_REGION * pixels;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (sizes[region[pixel]!]! >= floor) keyed[pixel * CHANNELS + 3] = 0;
  }
  return { data: keyed, width, height };
}

const downscale: PostProcessor = async (image, spec) =>
  // libvips premultiplies alpha across a resize, so a matted edge does not fringe on the way down.
  toRgba(sharpFrom(image).resize(spec.width, spec.height, { fit: 'fill', kernel: 'lanczos3' }));

const matte: PostProcessor = (image, _spec, options) =>
  Promise.resolve(
    transparencyOf(image) >= HUMAN_MATTE_FLOOR
      ? image
      : keyBackground(image, options.matteTolerance),
  );

/**
 * Every step the manifest can declare. Typed as a total `Record`, so adding a member to
 * `POST_PROCESS_STEPS` without an implementation fails to compile rather than at the paywall.
 */
const POST_PROCESSORS: Readonly<Record<PostProcessStep, PostProcessor>> = { matte, downscale };

/** The implementation of `step`. Throws for a step that reached us without one. */
export function postProcessorFor(step: PostProcessStep): PostProcessor {
  const processor = POST_PROCESSORS[step];
  if (processor === undefined) {
    throw new Error(`no implementation for post-process step "${step}" — refusing to pass through`);
  }
  return processor;
}

/** The steps declared anywhere in the manifest that this module cannot apply. */
export function unimplementedSteps(specs: readonly AssetSpec[] = ART_MANIFEST): PostProcessStep[] {
  const declared = new Set(specs.flatMap((spec) => spec.postProcess));
  return [...declared].filter((step) => POST_PROCESSORS[step] === undefined);
}

/* -------------------------------------------------------------------------- */
/* Encode                                                                      */
/* -------------------------------------------------------------------------- */

export interface EncodeResult {
  bytes: Uint8Array;
  /** Coverage-weighted transparency of the delivery, for the ART-BIBLE §6 gate and the CLI log. */
  transparency: number;
}

function encodeDelivery(image: RgbaImage, spec: AssetSpec): Promise<Buffer> {
  const classSpec = ASSET_CLASS_SPECS[spec.class];
  const pipeline = spec.alpha ? sharpFrom(image) : sharpFrom(image).removeAlpha();
  if (classSpec.ext === 'png') return pipeline.png({ compressionLevel: 9 }).toBuffer();
  if (classSpec.quality === null) {
    throw new Error(`${spec.key}: class "${spec.class}" delivers WebP but declares no quality`);
  }
  return pipeline.webp({ quality: classSpec.quality, alphaQuality: 100, effort: 6 }).toBuffer();
}

/**
 * Everything that must hold after the declared steps have run. A master that skipped its downscale,
 * or a matte that cut nothing, is an asset that looks fine on disk and wrong in the browser — so it
 * fails here rather than shipping.
 */
function deliveryProblems(image: RgbaImage, spec: AssetSpec, transparency: number): string[] {
  const problems: string[] = [];
  if (image.width !== spec.width || image.height !== spec.height) {
    problems.push(
      `post-process left it ${image.width}×${image.height}, ART-BIBLE §6 delivers ${spec.width}×${spec.height}`,
    );
  }
  if (spec.postProcess.includes('matte') && (transparency === 0 || transparency === 1)) {
    // Both ends are the same failure: the master had no background the key could tell from the
    // artwork, so it either kept everything or erased the city. That needs a human, not a retry.
    const outcome = transparency === 0 ? 'cut nothing' : 'cut the entire frame';
    problems.push(
      `the matte ${outcome} — the master has no flat keyable background, so it needs a human pass (ADR 0001 §6.4)`,
    );
  }
  if (spec.minTransparency !== undefined && transparency < spec.minTransparency) {
    problems.push(
      `${percent(transparency)} transparent, ART-BIBLE §6 requires at least ${percent(spec.minTransparency)} — re-key with a wider --matte-tolerance or hand-matte the master`,
    );
  }
  return problems;
}

/** Applies `spec.postProcess` in declared order, then encodes the ART-BIBLE §6 delivery file. */
export async function encodeAsset(
  master: Uint8Array,
  spec: AssetSpec,
  options: EncodeOptions = DEFAULT_ENCODE_OPTIONS,
): Promise<EncodeResult> {
  let image = await decodeMaster(master);
  if (image.width !== spec.source.width || image.height !== spec.source.height) {
    throw new Error(
      `${spec.key}: master is ${image.width}×${image.height}, the manifest declares a ${spec.source.width}×${spec.source.height} source`,
    );
  }

  for (const step of spec.postProcess) image = await postProcessorFor(step)(image, spec, options);

  const transparency = transparencyOf(image);
  const problems = deliveryProblems(image, spec, transparency);
  if (problems.length > 0) throw new Error(`${spec.key}: ${problems.join('; ')}`);

  return { bytes: await encodeDelivery(image, spec), transparency };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export interface CliOptions extends EncodeOptions {
  dryRun: boolean;
  masterDir: string;
  outDir: string;
  /** Asset keys to encode; empty means every manifest entry with a master on disk. */
  only: readonly string[];
}

const USAGE =
  'Usage: encode-art [--dry-run] [--masters DIR] [--out DIR] [--only KEYS] [--matte-tolerance N]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    masterDir: DEFAULT_MASTER_DIR,
    outDir: DEFAULT_ASSET_DIR,
    only: [],
    matteTolerance: DEFAULT_MATTE_TOLERANCE,
  };
  const only: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    i += 1;
    if (arg === '--masters') options.masterDir = path.resolve(value);
    else if (arg === '--out') options.outDir = path.resolve(value);
    else if (arg === '--only') only.push(...value.split(',').filter(Boolean));
    else if (arg === '--matte-tolerance') options.matteTolerance = parseTolerance(value);
    else throw new Error(`Unknown argument "${arg}". ${USAGE}`);
  }
  return { ...options, only };
}

function parseTolerance(value: string): number {
  const tolerance = Number(value);
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new Error(`--matte-tolerance must be an integer 0–255, got "${value}"`);
  }
  return tolerance;
}

export function selectSpecs(only: readonly string[]): readonly AssetSpec[] {
  if (only.length === 0) return ART_MANIFEST;
  return only.map((key) => {
    const spec = findAssetSpec(key);
    if (!spec) throw new Error(`Unknown asset key "${key}"`);
    return spec;
  });
}

export function masterInputPath(masterDir: string, spec: AssetSpec): string {
  return path.join(masterDir, `${spec.key}.png`);
}

export function deliveryOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, spec.file);
}

/**
 * What `--dry-run` checks and a real run refuses to start without: the manifest is legal and every
 * post-process it declares has an implementation here. Returns one line per problem.
 */
export function validateRun(specs: readonly AssetSpec[]): string[] {
  const problems = specs.flatMap((spec) =>
    validateAssetSpec(spec).map((problem) => `${spec.key}: ${problem}`),
  );
  for (const step of unimplementedSteps(specs)) {
    problems.push(`post-process step "${step}" is declared by the manifest but not implemented`);
  }
  return problems;
}

/** The subset of `specs` whose master has actually been generated. */
async function withMasters(
  specs: readonly AssetSpec[],
  masterDir: string,
): Promise<{ present: readonly AssetSpec[]; missing: readonly AssetSpec[] }> {
  const files = new Set(await readdir(masterDir).catch(() => []));
  const present = specs.filter((spec) => files.has(`${spec.key}.png`));
  return { present, missing: specs.filter((spec) => !present.includes(spec)) };
}

export async function encodeAll(specs: readonly AssetSpec[], options: CliOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });
  for (const spec of specs) {
    const { bytes, transparency } = await encodeAsset(
      await readFile(masterInputPath(options.masterDir, spec)),
      spec,
      options,
    );
    await writeFile(deliveryOutputPath(options.outDir, spec), bytes);
    process.stdout.write(`${spec.file}  ${describeEncode(spec, transparency, bytes.length)}\n`);
  }
}

function describeEncode(spec: AssetSpec, transparency: number, size: number): string {
  const steps = spec.postProcess.length > 0 ? spec.postProcess.join(' + ') : 'no post-process';
  const alpha = spec.alpha ? `, ${percent(transparency)} transparent` : '';
  return `${steps}${alpha}, ${Math.round(size / 1024)} kB`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  let specs: readonly AssetSpec[];
  try {
    options = parseArgs(argv);
    specs = selectSpecs(options.only);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  const problems = validateRun(specs);
  if (problems.length > 0) {
    process.stderr.write(`${problems.length} problem(s):\n`);
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    return 1;
  }

  const { present, missing } = await withMasters(specs, options.masterDir);

  if (options.dryRun) {
    process.stdout.write(
      `${POST_PROCESS_STEPS.length} post-process step(s) implemented; ${specs.length} asset(s) validated:\n`,
    );
    for (const spec of present) {
      process.stdout.write(`  ${spec.key}.png → ${spec.file}  [${describePlan(spec)}]\n`);
    }
    if (missing.length > 0) {
      process.stdout.write(
        `${missing.length} master(s) not generated yet — run gen-art first: ${missing.map((s) => s.key).join(', ')}\n`,
      );
    }
    return 0;
  }

  if (missing.length > 0) {
    process.stderr.write(
      `${missing.length} master(s) missing from ${options.masterDir}: ${missing.map((s) => s.key).join(', ')}\n`,
    );
    return 1;
  }

  try {
    await encodeAll(present, options);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  return 0;
}

function describePlan(spec: AssetSpec): string {
  return spec.postProcess.length === 0 ? 'encode only' : spec.postProcess.join(' + ');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
