/**
 * The encode stage (ADR 0001 §4.1): master → ART-BIBLE §6 delivery file.
 *
 * A **master** per asset lands in `art-src/` as `<key>.png` or `<key>.webp`. For 14 of the assets
 * that master is deliberately not the delivery image — no backend renders 512×512 with alpha and
 * none renders 16:9 with alpha at all — so the manifest declares `spec.postProcess`, the steps that
 * close the gap. This runner normalizes the master to `spec.source`, applies those steps, then
 * encodes the result as `spec.file` (WebP at `ASSET_CLASS_SPECS[class].quality`, or lossless PNG)
 * into the `assets/` drop directory.
 *
 *   pnpm --filter @frontline/scripts encode-art --dry-run
 *   pnpm --filter @frontline/scripts encode-art --only icon-scrap
 *   pnpm --filter @frontline/scripts encode-art --landed    # whatever has arrived so far
 *   pnpm --filter @frontline/scripts encode-art --painted   # what the game actually renders
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
  ASSET_CLASSES,
  ASSET_CLASS_SPECS,
  POST_PROCESS_STEPS,
  findAssetSpec,
  validateAssetSpec,
  type AssetClass,
  type AssetKey,
  type AssetSpec,
  type PostProcessStep,
} from '@frontline/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where `gen-art.ts` leaves its masters (ADR 0001 §5.1). Never shipped. */
export const DEFAULT_MASTER_DIR = path.join(REPO_ROOT, 'art-src');
/** The drop directory the client globs — see `assets/README.md`. */
export const DEFAULT_ASSET_DIR = path.join(REPO_ROOT, 'assets');
/** Holds the §9 licensing register, the provenance record `assets/` is audited against. */
export const DEFAULT_ART_BIBLE_PATH = path.join(REPO_ROOT, 'docs', 'ART-BIBLE.md');

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
 * Window of the median filter the key is decided on. A diffusion backend hands back per-pixel grain
 * even where the prompt asked for a flat field; matched against the seed independently, each grainy
 * pixel is its own 1-px region, falls under {@link MIN_KEYED_REGION} and stays **opaque**. That ships
 * a speckled sky the coverage-weighted §6 gate cannot see, because it measures how much transparency
 * there is and not whether it is connected. A 3×3 median is exactly the filter for per-pixel grain,
 * and it does not move the boundary of a *region*.
 *
 * It does delete a *structure* thinner than the window. A 1-px line is 3 of the 9 samples in every
 * window it touches, so the median returns the field, the line joins the background region and its
 * alpha is cleared — the master's own RGB survives, which is not the same as surviving. Measured on
 * a 2048×1152 fore plane the threshold is sharp: **≤1 px is destroyed, ≥2 px is intact**, with or
 * without grain and with or without antialiasing. Nothing about that is recoverable here — a 1-px
 * antialiased line lands the same distance off the field colour as the antialiased edge of a solid
 * mass, so no per-pixel test can tell them apart. {@link MAX_ERASED_ARTWORK} makes it loud instead,
 * and ART-BIBLE §6.2 puts a 3px minimum stroke weight on every keyed asset, so that a funded master
 * does not carry the shape in the first place.
 */
const DENOISE_WINDOW = 3;

/**
 * The dual of {@link MIN_KEYED_REGION}: an opaque island smaller than this is cleared along with the
 * background. Absolute rather than a share of the canvas — `MIN_KEYED_REGION` of a 2048×1152 frame is
 * ≈108×108, which would erase a genuine distant spire or drone, while 64 px (8×8 of a full-screen
 * parallax layer) can only be grain the denoise did not reach.
 *
 * This sweep bounds how *small* a surviving piece can be, not how *many* there are — past a noise
 * floor the misses clump into islands bigger than this and it stops helping. {@link MAX_KEYED_ISLANDS}
 * is what covers that end.
 *
 * It is a trade, not a free win, and the trade is that anything detached and smaller than 8×8 is
 * gone: a 6×6 drone in a fore-plane layout is deleted on a clean master. That is the deliberate
 * price of never shipping speckle, and {@link MAX_ERASED_ARTWORK} bounds how much of it a run may
 * pay before the matte is refused outright.
 */
export const MIN_OPAQUE_ISLAND = 64;

/**
 * Opaque pieces a keyed plane may be left in before the matte counts as failed.
 *
 * The island sweep guarantees no piece is *small*, not that there are few of them: past the point
 * where the master's noise floor exceeds `--matte-tolerance`, the misses stop being isolated pixels
 * and clump into islands the sweep is right to keep. Fragmentation is what separates the two cases,
 * and it separates them by orders of magnitude. Measured on 2048×1152 synthetic planes at
 * {@link DEFAULT_MATTE_TOLERANCE}: a legitimate `plane-city-fore` layout (edge occluders, a drone,
 * detached spires) keys to **2** pieces and stays there through ±30 grain; ±35 — the last level
 * that still ships — reads **42**, ±36 reads **114**, and ±40 reads **1396**. 64 sits in the empty
 * gap between 42 and 114. (The ±18/±20 boundary quoted before MOU-152 was the test suite's skewed
 * grain generator, not this gate moving.)
 */
export const MAX_KEYED_ISLANDS = 64;

/**
 * How far off the field colour a pixel must sit, as a multiple of `tolerance`, before the master is
 * taken to be stating that it is artwork rather than noise.
 *
 * Two things live inside one multiple of the tolerance and must not be counted: the grain the key
 * exists to absorb, and the antialiased ribbon along every silhouette, whose colour interpolates
 * between the artwork and the field. Doubling clears the ribbon outright — it sits at roughly the
 * midpoint of a separation the operator is required to keep above the tolerance in the first place.
 *
 * It does **not** clear grain, and no fixed multiple can: this is a constant cut through a noise
 * distribution the master never declares. A bounded one stays under it — uniform ±25 against
 * tolerance 18 never reaches 36 — but any distribution with tails puts field pixels past it at
 * whatever rate the tail carries, and a flat sky is 1.4M chances. {@link MIN_ERASED_RUN} is what
 * separates those from an erasure; this multiple only has to keep the ribbon out.
 */
const ARTWORK_MARGIN = 2;

/**
 * Flagged pixels in a connected run shorter than this are grain, not erased artwork.
 *
 * {@link ARTWORK_MARGIN} cannot tell one tail pixel of grain from one pixel of a cable, and per
 * pixel nothing can. Shape can: an erased structure is a **line**, so its pixels flag as one long
 * 8-connected run, while grain flags as dust — isolated pixels and pairs, scattered across the whole
 * field. Grouping the flagged set and keeping only runs of at least 16 is what makes the count
 * measure erasure rather than the noise floor.
 *
 * Measured on the suite's `gaussianSkyline(2048, 1152, 0.3, σ)` at {@link DEFAULT_MATTE_TOLERANCE} —
 * **Gaussian** grain, unbounded, so it exercises the tail the uniform generator has none of. Every
 * one of these keys to 70.0% transparency and **1 island**, i.e. flawlessly:
 *
 * | σ | flagged pixels | kept, in runs ≥ 16 |
 * | --- | --- | --- |
 * | 8 | 20 | **0** |
 * | 10 | 856 | **0** |
 * | 12 | 7,579 | **0** |
 * | 16 | 73,030 | **0** |
 * | 20 | 214,582 | 478 |
 *
 * The structure it is there to keep survives it whole: on `cabledPlane` a 1-px cable reads 2,032
 * clean and 2,059 at σ 12 (from 9,602 unfiltered), against 0 for a 2-px or 3-px cable at either.
 * See {@link MAX_ERASED_ARTWORK} for the band this leaves and what happens past it.
 *
 * **The cost is a blind spot, and it is unbounded.** An erasure whose flagged run is shorter than
 * this is invisible, and no number of them ever adds up — the total is over runs that clear the
 * floor, so a master carrying only short ones reads exactly 0 however much it has lost. A 1-px
 * antenna drawn `n` px tall leaves an `n - 2` px run (the pixel touching the roofline survives the
 * median, and the one above it is excluded as adjacent to a survivor), so on a 2048×1152 roofline:
 * **150 antennae 14 px tall erase 2,100 px of ART-BIBLE §6.2-violating structure and read 0**, while
 * the same antennae at 18 px drawn read 640 for 40 of them and are refused. Detached islands cross
 * the same line by area: 300 × 3×3 is 2,700 px drawn and reads 0, a 4×4 counts.
 *
 * Lowering it does not fix that, it just moves the wall, and the grain distribution says where the
 * wall is. Measured on the same flat `gaussianSkyline`, the longest 8-connected run grain produces
 * is **10 px at σ 16 and 14 px at σ 18** — a 14-px antenna and a grain clump are the same object to
 * a run-length statistic. What a lower floor would read on a *flawless* σ 18 key, against the 256
 * budget: 16 → 0, 14 → 28, 12 → 88, 10 → 243, **9 → 387, refused**. So nothing under 10 is
 * available at all (the 3×3 island needs 9), and the range that is available buys a shorter
 * structure by spending the headroom that keeps a grainy master from being refused for artwork it
 * does not have — which is the failure this floor was added to fix. 16 keeps that headroom whole.
 * ART-BIBLE §6.2's minimum stroke weight is the only cover for what is left, as it is for the
 * rim-on-a-mass case in {@link MAX_ERASED_ARTWORK}.
 */
const MIN_ERASED_RUN = 16;

/**
 * Pixels of unambiguous artwork the key may take the alpha off before the matte counts as failed.
 *
 * {@link DENOISE_WINDOW} deletes any structure thinner than itself, and the two gates above both
 * move the *wrong* way when it does: deleting artwork raises transparency past the §6 floor and
 * lowers the island count. This is what sees it — alpha cleared from a pixel the master puts beyond
 * {@link ARTWORK_MARGIN}× the tolerance from the field, with no surviving pixel 4-adjacent to it,
 * and joined to at least {@link MIN_ERASED_RUN} others like it. The adjacency clause is what
 * excludes the antialiased ribbon, which always has kept artwork against it; the run floor is what
 * excludes grain. Two thin structures this cannot see: a *rim highlight* painted onto a kept mass,
 * because every erased pixel there has surviving artwork against it, and anything erased in runs
 * under {@link MIN_ERASED_RUN}, at any multiplicity. ART-BIBLE §6.2's minimum stroke weight is what
 * covers both.
 *
 * Measured on 2048×1152 fore-plane layouts, hard-edged, silhouettes plain and busy, artwork 45
 * levels off the field, under both generators the suite carries — clean, uniform ±12 and ±25,
 * Gaussian σ 8, 12 and 16: a plane whose thinnest element is ≥2 px reads **0** at every level, and
 * one carrying a 1-px cable reads **1730 to 2156**. The median returns the field for a line that is
 * only 3 of its 9 samples, so the erasure is there whether the master is clean or grainy. 256 sits
 * in that gap with 6.7× headroom. That range is what those layouts erase, not a general figure for
 * a 1-px cable: the count scales with the structure's length, and the suite's own `cabledPlane`,
 * whose cable spans the full 2048, reads 2,032 clean and 2,568 at σ 20.
 *
 * That separation is a precondition, not a detail. {@link ARTWORK_MARGIN} is what decides whether
 * the master is *stating* a pixel is artwork, so artwork drawn too close to the field stops this
 * discriminating in **both** directions — a thin element reads 0 and a legal one reads an erasure.
 * ART-BIBLE §6.3's minimum artwork-to-field separation is what keeps that out of the funded masters,
 * and carries the measurements. It is stated as 4× the tolerance rather than as a fixed number of
 * levels, so it moves with this run: widening `--matte-tolerance` to 30 to key a grainier field asks
 * for 120 levels of separation, which a master authored against {@link DEFAULT_MATTE_TOLERANCE} does
 * not have.
 *
 * Past the grain levels above the gate stops discriminating and only refuses: at Gaussian σ 20 a
 * clean flat sky reads 478 and is refused, because at that noise floor a 45-level cable genuinely is
 * not separable from the field per pixel. That is a defensible refusal, which is why the message
 * names `--matte-tolerance` first and does not assert which of the two causes it found.
 *
 * An absolute count, like {@link MIN_OPAQUE_ISLAND} and for the same reason: an erasure scales with
 * the length of the structure, not with the area of the canvas, and both matte assets are declared
 * at 2048×1152. On a materially smaller canvas it would want re-measuring.
 */
export const MAX_ERASED_ARTWORK = 256;

/**
 * Mean-shift passes that recentre the histogram peak on the field's real colour before keying.
 *
 * The peak bucket is 16 levels wide, so its centroid can sit several levels off a noisy field's true
 * colour — the noise spills across a bucket boundary and the peak keeps only the slice on one side.
 * That offset comes straight out of the tolerance budget, and the pixels it pushes out of range are
 * spatially correlated, so they clump into islands too big for {@link MIN_OPAQUE_ISLAND} to sweep.
 * Recentring on the mean of what currently matches converges on the field itself.
 */
const SEED_REFINEMENT_PASSES = 3;

/**
 * The master's dominant colour: the mean of the fullest bucket of a quantised RGB histogram.
 *
 * The backends cannot render alpha, so asked for a "transparent background" they paint a large flat
 * field instead. That field is by far the most common colour in the frame, wherever it sits — which
 * is the point: `plane-city-far` is transparent along the **top**, `plane-city-fore` through its
 * **centre**, so nothing may assume the background touches any particular edge.
 */
function backgroundColour(image: RgbaImage, tolerance: number): [number, number, number] {
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
  const centroid = sums.map((sum) => Math.round(sum / counts[peak]!)) as [number, number, number];

  let seed = centroid;
  for (let pass = 0; pass < SEED_REFINEMENT_PASSES; pass += 1) {
    seed = recentre(image, seed, tolerance);
  }
  return seed;
}

/** The mean of every pixel within `tolerance` of `seed` — one mean-shift pass. */
function recentre(
  image: RgbaImage,
  seed: [number, number, number],
  tolerance: number,
): [number, number, number] {
  const { data } = image;
  const sums = [0, 0, 0];
  let matched = 0;
  for (let offset = 0; offset < data.length; offset += CHANNELS) {
    if (
      Math.abs(data[offset]! - seed[0]) > tolerance ||
      Math.abs(data[offset + 1]! - seed[1]) > tolerance ||
      Math.abs(data[offset + 2]! - seed[2]) > tolerance
    ) {
      continue;
    }
    for (let c = 0; c < 3; c += 1) sums[c]! += data[offset + c]!;
    matched += 1;
  }
  if (matched === 0) return seed;
  return sums.map((sum) => Math.round(sum / matched)) as [number, number, number];
}

/** A keyed master, plus the two measurements `matte` refuses on. */
export interface KeyedImage extends RgbaImage {
  /** Opaque pieces the key left standing, counted after the {@link MIN_OPAQUE_ISLAND} sweep. */
  islands: number;
  /** Pixels of unambiguous artwork the key cleared — see {@link MAX_ERASED_ARTWORK}. */
  erased: number;
}

/** Connected regions of the pixels satisfying some predicate, labelled and measured. */
interface Regions {
  /** Region id per pixel; 0 for a pixel the predicate rejected. */
  ids: Int32Array;
  /** Pixel count per region id. `sizes[0]` is 0, so an unmatched pixel measures as no region. */
  sizes: readonly number[];
}

/**
 * Which neighbours count as touching. Areas are traced 4-connected, so a region cannot leak across a
 * diagonal pinch; the thin structures {@link erasedArtwork} looks for are traced 8-connected,
 * because a 1-px line at any angle other than the two axes *is* a diagonal chain.
 */
type Connectivity = 4 | 8;

function connectedRegions(
  width: number,
  height: number,
  matches: (pixel: number) => boolean,
  connectivity: Connectivity,
): Regions {
  const pixels = width * height;
  const ids = new Int32Array(pixels);
  const sizes: number[] = [0];
  const stack = new Int32Array(pixels);

  for (let seed = 0; seed < pixels; seed += 1) {
    if (ids[seed] !== 0 || !matches(seed)) continue;
    const id = sizes.length;
    let size = 0;
    let top = 1;
    ids[seed] = id;
    stack[0] = seed;

    while (top > 0) {
      top -= 1;
      const pixel = stack[top]!;
      size += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      const visit = (neighbour: number): void => {
        if (ids[neighbour] !== 0 || !matches(neighbour)) return;
        // Claimed at push time, so every pixel enters the stack at most once.
        ids[neighbour] = id;
        stack[top] = neighbour;
        top += 1;
      };
      if (x > 0) visit(pixel - 1);
      if (x < width - 1) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y < height - 1) visit(pixel + width);
      if (connectivity === 8) {
        if (x > 0 && y > 0) visit(pixel - width - 1);
        if (x < width - 1 && y > 0) visit(pixel - width + 1);
        if (x > 0 && y < height - 1) visit(pixel + width - 1);
        if (x < width - 1 && y < height - 1) visit(pixel + width + 1);
      }
    }
    sizes.push(size);
  }
  return { ids, sizes };
}

/** A pixel the master itself puts too far off the field colour to be grain or an antialiased edge. */
type IsArtwork = (pixel: number) => boolean;

/**
 * Pixels of artwork the key cleared and left with nothing standing beside them, counted only where
 * {@link MIN_ERASED_RUN} of them join up — the signature of a structure the {@link DENOISE_WINDOW}
 * median erased. See {@link MAX_ERASED_ARTWORK} for why it is measured this way and for the one case
 * it cannot see.
 */
function erasedArtwork(master: RgbaImage, keyed: Buffer, isArtwork: IsArtwork): number {
  const { width, height } = master;
  const survives = (pixel: number): boolean => keyed[pixel * CHANNELS + 3] !== 0;

  const flagged = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * CHANNELS;
    if (master.data[offset + 3] === 0 || survives(pixel) || !isArtwork(pixel)) continue;
    const x = pixel % width;
    const y = (pixel - x) / width;
    const beside =
      (x > 0 && survives(pixel - 1)) ||
      (x < width - 1 && survives(pixel + 1)) ||
      (y > 0 && survives(pixel - width)) ||
      (y < height - 1 && survives(pixel + width));
    if (!beside) flagged[pixel] = 1;
  }

  const runs = connectedRegions(width, height, (pixel) => flagged[pixel] === 1, 8);
  return runs.sizes.reduce((total, size) => (size >= MIN_ERASED_RUN ? total + size : total), 0);
}

/**
 * Cuts an alpha channel out of an opaque master by clearing every **contiguous region** of the
 * background colour that covers at least {@link MIN_KEYED_REGION} of the canvas, then clearing every
 * opaque island left under {@link MIN_OPAQUE_ISLAND}.
 *
 * Connectivity is what makes this safe to run unattended: a window light or a rim highlight that
 * happens to sit within `tolerance` of the sky is its own tiny region and survives, while the flat
 * field the backend painted in place of transparency goes, wherever in the frame it sits.
 *
 * Grain is what makes that hard. A backend hands back a "flat" field with per-pixel noise in it, and
 * a seed-relative match reads every noisy pixel as its own 1-px region that {@link MIN_KEYED_REGION}
 * then keeps **opaque** — a sky full of dots, which the coverage-weighted §6 gate cannot see because
 * it measures how much transparency there is and not whether it is connected. Three things answer it:
 * the key is decided on a {@link DENOISE_WINDOW} median and applied to the master's own pixels, so
 * the kept edge stays at full resolution; the seed is recentred off the quantised histogram peak
 * ({@link SEED_REFINEMENT_PASSES}); and the leftovers are swept by {@link MIN_OPAQUE_ISLAND}.
 *
 * None of that is a guarantee — past a noise floor the sweep's leftovers stop being specks and clump
 * into islands worth keeping — so {@link islands} reports the fragmentation and `matte` refuses
 * anything past {@link MAX_KEYED_ISLANDS} rather than shipping it.
 *
 * The denoise has a cost of its own, at the other end of the scale: it deletes any structure thinner
 * than its window, and a 1-px cable or rim is exactly the kind of thing the `plane-city-fore` prompt
 * asks for. That is not repairable here (see {@link DENOISE_WINDOW}), so {@link erased} measures it
 * and `matte` refuses past {@link MAX_ERASED_ARTWORK} instead of shipping a dashed cable.
 *
 * Matching is against the seed colour, never a pixel's neighbour — chained tolerance walks a
 * gradient and would quietly eat the artwork. A master whose background is not flat therefore keys
 * badly on purpose and fails the ART-BIBLE §6 gate rather than shipping a hole in the city.
 *
 * The mask is binary. Edge feathering is a human-pass concern, not something to fake here.
 */
export async function keyBackground(image: RgbaImage, tolerance: number): Promise<KeyedImage> {
  const { width, height } = image;
  const pixels = width * height;
  const flat = await toRgba(sharpFrom(image).median(DENOISE_WINDOW));
  const [seedR, seedG, seedB] = backgroundColour(flat, tolerance);

  const within = (data: Buffer, pixel: number, distance: number): boolean => {
    const offset = pixel * CHANNELS;
    return (
      Math.abs(data[offset]! - seedR) <= distance &&
      Math.abs(data[offset + 1]! - seedG) <= distance &&
      Math.abs(data[offset + 2]! - seedB) <= distance
    );
  };
  const matchesSeed = (pixel: number): boolean => within(flat.data, pixel, tolerance);
  const isArtwork = (pixel: number): boolean =>
    !within(image.data, pixel, tolerance * ARTWORK_MARGIN);

  const keyed = Buffer.from(image.data);
  const alphaOf = (pixel: number): number => keyed[pixel * CHANNELS + 3]!;
  const clear = (pixel: number): void => {
    keyed[pixel * CHANNELS + 3] = 0;
  };

  const background = connectedRegions(width, height, matchesSeed, 4);
  const keyedFloor = MIN_KEYED_REGION * pixels;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (background.sizes[background.ids[pixel]!]! >= keyedFloor) clear(pixel);
  }

  // Clearing a pixel that is already clear is a no-op, so region 0 needs no special case here.
  const islands = connectedRegions(width, height, (pixel) => alphaOf(pixel) !== 0, 4);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (islands.sizes[islands.ids[pixel]!]! < MIN_OPAQUE_ISLAND) clear(pixel);
  }
  const survivors = islands.sizes.filter((size) => size >= MIN_OPAQUE_ISLAND).length;
  return {
    data: keyed,
    width,
    height,
    islands: survivors,
    erased: erasedArtwork(image, keyed, isArtwork),
  };
}

/* -------------------------------------------------------------------------- */
/* Normalize                                                                   */
/* -------------------------------------------------------------------------- */

/** A rectangle inside a master, in `sharp.extract` order. */
export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The largest centred rectangle inside `image` with `target`'s aspect ratio.
 *
 * Centred rather than saliency-cropped: `sharp`'s attention strategy picks its own rectangle per
 * image, so the same master would frame differently across `sharp` versions and no test could pin
 * it. The manifest already declares each asset's framing, and a board that wants a different one
 * crops the file before dropping it in.
 *
 * Compared by cross-multiplication rather than by a float ratio — an off-by-one in the ratio is a
 * one-pixel shear at 4K, and the integer comparison is exact.
 */
export function centredCrop(
  image: Pick<RgbaImage, 'width' | 'height'>,
  target: { width: number; height: number },
): CropRect {
  const wider = image.width * target.height > image.height * target.width;
  const width = wider ? Math.floor((image.height * target.width) / target.height) : image.width;
  const height = wider ? image.height : Math.floor((image.width * target.height) / target.width);
  return {
    left: Math.floor((image.width - width) / 2),
    top: Math.floor((image.height - height) / 2),
    width,
    height,
  };
}

/**
 * Master → `spec.source`: centre-crop to the declared aspect ratio, then downscale.
 *
 * A generator renders to order, so this used to be a size *assertion*. A CC0 master is whatever
 * size its uploader saved, in whatever aspect they framed, and refusing those left `assets/` empty
 * however much art the board found — so the shape is brought to the manifest instead of the other
 * way round, with **zero TypeScript per asset**.
 *
 * It normalizes to `spec.source`, not to the delivery size, so the ordering the manifest declares
 * is untouched: `matte` still runs at source resolution against a canvas the size its gates were
 * measured on (`MAX_ERASED_ARTWORK`, `MIN_OPAQUE_ISLAND`), and the declared `downscale` still
 * closes the last step with premultiplied alpha. Cropping to `spec.source`'s ratio is the same
 * crop as cropping to the delivery's: `validateAssetSpec` refuses a spec whose source and delivery
 * disagree on aspect, and `validateRun` runs it before any of this.
 *
 * **It will not upscale.** A master that centre-crops to less than `spec.source` in either axis is
 * refused, naming the size it would need — inventing detail to fill a delivery is the one failure
 * that looks fine on disk and mushy in the browser.
 */
export async function normalizeMaster(image: RgbaImage, spec: AssetSpec): Promise<RgbaImage> {
  const { source } = spec;
  // The generator-shaped case, and the one every existing master takes: nothing to do, and no
  // resample to soften an already-exact master.
  if (image.width === source.width && image.height === source.height) return image;

  const crop = centredCrop(image, source);
  if (crop.width < source.width || crop.height < source.height) {
    // The scale that makes the master cover the source box. Taken off the master's own dimensions
    // rather than off `crop`, whose floor would round the answer up past the sizes that do work.
    const scale = Math.max(source.width / image.width, source.height / image.height);
    throw new Error(
      `${spec.key}: master is ${image.width}×${image.height}, which centre-crops to ` +
        `${crop.width}×${crop.height} at the manifest's ${source.width}×${source.height} source ` +
        `aspect — short of it, and upscaling invents detail. At this master's aspect ratio the ` +
        `smallest one that works is ${Math.ceil(image.width * scale)}×${Math.ceil(image.height * scale)}.`,
    );
  }

  return toRgba(
    sharpFrom(image)
      .extract(crop)
      .resize(source.width, source.height, { fit: 'fill', kernel: 'lanczos3' }),
  );
}

const downscale: PostProcessor = async (image, spec) =>
  // libvips premultiplies alpha across a resize, so a matted edge does not fringe on the way down.
  toRgba(sharpFrom(image).resize(spec.width, spec.height, { fit: 'fill', kernel: 'lanczos3' }));

const matte: PostProcessor = async (image, spec, options) => {
  if (transparencyOf(image) >= HUMAN_MATTE_FLOOR) return image;
  const keyed = await keyBackground(image, options.matteTolerance);
  if (keyed.islands > MAX_KEYED_ISLANDS) {
    throw new Error(
      `${spec.key}: the matte left the plane in ${keyed.islands} disconnected pieces — the master's ` +
        `background is grainier than --matte-tolerance ${options.matteTolerance} allows for, so the key ` +
        `is shot through with speckle. Re-key with a wider --matte-tolerance, or hand-matte the ` +
        `master (ADR 0001 §6.4).`,
    );
  }
  if (keyed.erased > MAX_ERASED_ARTWORK) {
    throw new Error(
      `${spec.key}: the matte cleared ${keyed.erased}px the master states are artwork, in runs too ` +
        `long to be grain. Either the master's background is noisier than --matte-tolerance ` +
        `${options.matteTolerance} allows for — try a wider one — or it carries structure thinner ` +
        `than the ${DENOISE_WINDOW}px key window (a 1px cable, antenna or rim), which the key ` +
        `cannot represent and would ship as a dashed line; regenerate that master with the ` +
        `ART-BIBLE §6.2 minimum stroke weight. Failing both, hand-matte it (ADR 0001 §6.4).`,
    );
  }
  return keyed;
};

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

/**
 * Exported for the test that pins `removeAlpha()`. That assertion cannot be written against
 * {@link encodeAsset}: `deliveryProblems` now rejects any transparency under an `alpha: false` spec
 * (MOU-374), so nothing carrying alpha reaches here through the public entry point, and libwebp
 * drops an all-opaque band by itself — which leaves `hasAlpha` reading the same with or without the
 * call. Reaching the unit directly is what keeps both checks live at once (MOU-377).
 */
export function encodeDelivery(image: RgbaImage, spec: AssetSpec): Promise<Buffer> {
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
 *
 * `spec.minTransparency` carries whatever floor ART-BIBLE §6 (`docs/ART-BIBLE.md`) declares and no
 * number invented here — ≥55% for `plane-city-fore`, ≥30% for `plane-city-far`. The floor is what
 * catches a key that *succeeded over too small a band*: the cut-nothing check below and
 * `MAX_KEYED_ISLANDS` only catch one that failed outright, and a far plane matted over a sliver
 * would otherwise pass both and hide the sky plane behind it.
 *
 * The last check is the mirror image of the matte pair, for the keys that declare no alpha at all:
 * `encodeDelivery` strips their band with `removeAlpha()`, which *discards* it rather than
 * compositing, so a master that is transparent anywhere ships whatever RGB was hiding under it —
 * black patches, for a master with nothing painted there. No other gate sees it: `minTransparency`
 * is attached only to the two planes, and `matte` is never declared for an opaque delivery
 * (`postProcessFor`), so both checks above are inert on exactly the keys the board's masters land
 * on (MOU-374).
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
  if (!spec.alpha && transparency > 0) {
    problems.push(
      `the master carries alpha over ${percent(transparency)} of the frame but "${spec.class}" ` +
        `delivers none — removeAlpha() drops the band without compositing, so whatever RGB sits ` +
        `under it ships as artwork. Flatten the master onto its intended background first ` +
        `(ADR 0001 §6.4)`,
    );
  }
  return problems;
}

/**
 * Normalizes the master to `spec.source`, applies `spec.postProcess` in declared order, then
 * encodes the ART-BIBLE §6 delivery file.
 */
export async function encodeAsset(
  master: Uint8Array,
  spec: AssetSpec,
  options: EncodeOptions = DEFAULT_ENCODE_OPTIONS,
): Promise<EncodeResult> {
  let image = await normalizeMaster(await decodeMaster(master), spec);

  for (const step of spec.postProcess) image = await postProcessorFor(step)(image, spec, options);

  const transparency = transparencyOf(image);
  const problems = deliveryProblems(image, spec, transparency);
  if (problems.length > 0) throw new Error(`${spec.key}: ${problems.join('; ')}`);

  return { bytes: await encodeDelivery(image, spec), transparency };
}

/* -------------------------------------------------------------------------- */
/* Delivery audit                                                              */
/* -------------------------------------------------------------------------- */

export interface DeliveryProblem {
  /** Path relative to the drop directory — a batch subfolder and `@2x` included. */
  file: string;
  key: AssetKey;
  problem: string;
}

/** Drops the ART-BIBLE §6 retina marker, so `plane-city-fore@2x.webp` audits against its 1× spec. */
function withoutRetinaMarker(file: string): string {
  return file.replace('@2x', '');
}

/**
 * Everything in the drop directory, as paths relative to it.
 *
 * Recursive because the client's glob is: `assets/**` in `apps/client/src/assets/source.ts` keys on
 * the **base name**, so `assets/batch-3/plane-city-fore.webp` reaches the browser exactly as a
 * top-level drop does. A flat walk would let a whole subdirectory of art past both audits.
 */
async function droppedFiles(dir: string): Promise<readonly string[]> {
  return (await readdir(dir, { recursive: true }).catch(() => [])).toSorted();
}

/**
 * Re-checks the ART-BIBLE §6 transparency floor against files that are **already** in `assets/`.
 *
 * {@link encodeAsset} applies the same floor, but only to masters it encodes itself. A delivery can
 * also arrive by hand — a CC0 file saved straight into the drop directory, which the client globs
 * by name (`apps/client/src/assets/source.ts`) — and that route never opens the pixels. That gap is
 * not theoretical: `plane-city-fore` draws *in front of* the district nodes, so an opaque foreground
 * delivered this way blankets the map — every node, base marker, label and the YOU indicator — and
 * nothing else in the build looks at it (MOU-289).
 *
 * Both densities are audited: the client takes `@2x` on retina and 1× elsewhere, so an opaque master
 * in either slot erases the map for the displays that resolve to it.
 */
export async function auditDeliveries(
  dir: string = DEFAULT_ASSET_DIR,
): Promise<readonly DeliveryProblem[]> {
  const floors = new Map<string, { spec: AssetSpec; floor: number }>(
    ART_MANIFEST.flatMap((spec) =>
      spec.minTransparency === undefined
        ? []
        : [[spec.file, { spec, floor: spec.minTransparency }] as const],
    ),
  );

  const problems: DeliveryProblem[] = [];
  for (const file of await droppedFiles(dir)) {
    const governed = floors.get(withoutRetinaMarker(path.basename(file)));
    if (governed === undefined) continue;

    let transparency: number;
    try {
      transparency = transparencyOf(await decodeMaster(await readFile(path.join(dir, file))));
    } catch (error) {
      // sharp names neither the file nor the key when it rejects one, and a hand-pasted batch is
      // exactly where a truncated download turns up. A delivery that fails has to name itself —
      // the contact sheet reports this audit too, and a bare throw there kills the whole run.
      problems.push({
        file,
        key: governed.spec.key,
        problem: `could not be read as an image — ${errorMessage(error)}`,
      });
      continue;
    }

    if (transparency >= governed.floor) continue;
    problems.push({
      file,
      key: governed.spec.key,
      problem:
        `${percent(transparency)} transparent, ART-BIBLE §6 requires at least ` +
        `${percent(governed.floor)} — an opaque delivery hides everything behind this plane`,
    });
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Provenance audit                                                            */
/* -------------------------------------------------------------------------- */

export interface ProvenanceProblem {
  /** Path relative to the drop directory — a batch subfolder and `@2x` included. */
  file: string;
  problem: string;
}

/** One parsed row of the ART-BIBLE §9 table. */
export interface LicensingRow {
  /** The `File` cell, backticks stripped. */
  file: string;
  /** Required columns this row leaves empty. */
  blank: readonly string[];
}

/**
 * §9 columns a row has to fill in. A row naming a file and saying nothing else records no
 * provenance — it only makes the register look populated, which is worse than an empty table.
 */
const REQUIRED_LICENSING_COLUMNS = ['Source', 'Author', 'Licence'] as const;

/** What `apps/client/src/assets/source.ts` globs; anything else in the directory is not art. */
const DELIVERY_EXTENSIONS = new Set(['.webp', '.png']);

/**
 * Reads the ART-BIBLE §9 licensing table out of the bible's markdown.
 *
 * The hand-maintained table is parsed rather than some machine-readable sidecar because §9 declares
 * *it* authoritative — "the one a lawyer would be shown". A second copy could pass the gate while
 * the document a human reads stayed empty.
 *
 * Columns are located by header name, so reordering the table does not silently re-point the
 * required-cell check at the wrong column. A renamed column reads as blank, which fails loudly.
 */
export function parseLicensingRegister(markdown: string): readonly LicensingRow[] {
  const section = markdown.split(/^## 9\. /m)[1]?.split(/^## /m)[0] ?? '';
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll('`', '')),
    );

  const header = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((cells) => cells[0] !== undefined && cells[0] !== '')
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)))
    .map((cells) => ({
      file: cells[0] ?? '',
      blank: REQUIRED_LICENSING_COLUMNS.filter(
        (column) => (cells[header.indexOf(column)] ?? '') === '',
      ),
    }));
}

/**
 * Requires every image in the drop directory to have an ART-BIBLE §9 licensing row.
 *
 * The board rule is absolute — *an asset with no recorded provenance does not ship* — and until now
 * it was the one art rule enforced by prose alone. `gen-art.ts` writes a `*.provenance.json`, but
 * only beside the **master** in `art-src/`, and only on the generate path, which is dormant and
 * key-gated. The route art actually arrives by is a file saved straight into `assets/`, which the
 * client globs by name and renders with nothing anywhere complaining (MOU-296).
 *
 * Every `.webp`/`.png` is audited, not only the ones matching a manifest delivery name: a misnamed
 * drop is inert in the browser but is still a third-party file sitting in the repo, and §9 covers
 * it. `@2x` resolves to the 1× row — two densities of one artwork are one licence, not two.
 *
 * A sibling `*.provenance.json` is deliberately *not* accepted in place of a row. §9 requires a row
 * for generated art too, so the JSON records the seed, never the permission.
 */
export async function auditProvenance(
  dir: string = DEFAULT_ASSET_DIR,
  biblePath: string = DEFAULT_ART_BIBLE_PATH,
): Promise<readonly ProvenanceProblem[]> {
  const rows = new Map(
    parseLicensingRegister(await readFile(biblePath, 'utf8')).map((row) => [row.file, row]),
  );

  const problems: ProvenanceProblem[] = [];
  for (const file of await droppedFiles(dir)) {
    if (!DELIVERY_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const name = path.basename(file);
    const row = rows.get(name) ?? rows.get(withoutRetinaMarker(name));
    if (row === undefined) {
      problems.push({
        file,
        problem:
          'no ART-BIBLE §9 licensing row — record the source, author and licence in ' +
          'docs/ART-BIBLE.md §9 before this file ships',
      });
    } else if (row.blank.length > 0) {
      problems.push({
        file,
        problem: `ART-BIBLE §9 row leaves ${row.blank.join(', ')} blank — a row that names a file and nothing else records no provenance`,
      });
    }
  }
  return problems;
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
  /**
   * Encode whatever masters have arrived and report the rest, instead of failing on the first
   * absence. The art run lands in hand-pasted batches, so "not downloaded yet" is the normal state
   * of most of `art-src/` and must not be indistinguishable from "the file you asked for is gone".
   * Off by default: a run that names its assets still gets the missing-master failure.
   */
  landed: boolean;
  /**
   * Report which manifest keys the game now renders from `assets/` and which still fall back to
   * procedural art, and encode nothing. Under CC0 sourcing the board finds files one at a time and
   * needs the painted fraction without listing a directory — see {@link paintedSplit} for why
   * `--landed` does not answer this.
   */
  painted: boolean;
}

const USAGE =
  'Usage: encode-art [--dry-run] [--landed] [--painted] [--masters DIR] [--out DIR] [--only KEYS] [--matte-tolerance N]';

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    masterDir: DEFAULT_MASTER_DIR,
    outDir: DEFAULT_ASSET_DIR,
    only: [],
    matteTolerance: DEFAULT_MATTE_TOLERANCE,
    landed: false,
    painted: false,
  };
  const only: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--landed') {
      options.landed = true;
      continue;
    }
    if (arg === '--painted') {
      options.painted = true;
      continue;
    }
    // Unknown before the value lookup, so a trailing bad flag reads as unknown, not as missing one.
    if (arg !== '--masters' && arg !== '--out' && arg !== '--only' && arg !== '--matte-tolerance') {
      throw new Error(`Unknown argument "${arg}". ${USAGE}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    i += 1;
    if (arg === '--masters') options.masterDir = path.resolve(value);
    else if (arg === '--out') options.outDir = path.resolve(value);
    else if (arg === '--only') only.push(...parseOnlyKeys(value));
    else options.matteTolerance = parseTolerance(value);
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

/**
 * An empty list means "every manifest entry" only when `--only` is absent. `--only "$KEY"` with an
 * unset shell variable must fail rather than silently widen to the whole manifest — the same trap
 * that turns a one-asset `gen-art` run into a funded 44-asset one.
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
 * What a master may arrive as. A generator wrote lossless PNG because we asked it to; a CC0 file is
 * whatever its uploader saved, and WebP is most of the archives. Both decode losslessly enough for
 * the matte — the key is decided on a {@link DENOISE_WINDOW} median, which absorbs more than WebP's
 * chroma handling costs.
 */
export const MASTER_EXTENSIONS = ['png', 'webp'] as const;

/** A master that has arrived, paired with the spec it satisfies. */
export interface Master {
  spec: AssetSpec;
  /** Bare file name inside the master directory — `<key>.png` or `<key>.webp`. */
  file: string;
}

/**
 * The master file for `spec` among `files`, or `undefined` when none has arrived.
 *
 * Both extensions present is a failure rather than a preference order: the two files are different
 * art, and picking one silently makes which one ships depend on the order of this array.
 */
export function masterFileFor(spec: AssetSpec, files: ReadonlySet<string>): string | undefined {
  const names = MASTER_EXTENSIONS.map((ext) => `${spec.key}.${ext}`).filter((name) =>
    files.has(name),
  );
  if (names.length > 1) {
    throw new Error(
      `${spec.key}: masters at ${names.join(' and ')} — they are different art, so delete the one ` +
        `that is not the master rather than leaving the encode to pick.`,
    );
  }
  return names[0];
}

export function deliveryOutputPath(outDir: string, spec: AssetSpec): string {
  return path.join(outDir, spec.file);
}

/* -------------------------------------------------------------------------- */
/* Painted vs procedural                                                       */
/* -------------------------------------------------------------------------- */

/** One asset class's painted-vs-procedural split. */
export interface PaintedClass {
  class: AssetClass;
  /** Keys the client draws from `assets/`. */
  painted: readonly AssetKey[];
  /** Keys still falling back to `apps/client/src/render/procedural.ts` (ADR 0001 §5.3). */
  procedural: readonly AssetKey[];
}

/**
 * Which manifest keys the game actually renders from `assets/` and which still fall back to
 * procedural art, grouped by class.
 *
 * A key is painted when its exact `spec.file` is on disk — the same test
 * `apps/client/src/assets/source.ts` applies, and the reason `@2x` alone does not count: the client
 * falls back from retina to 1×, never the other way.
 *
 * `--landed` answers a different question and is not a proxy for this one. That reports which
 * *masters* reached `art-src/`; a master that lands and then fails its matte paints nothing.
 */
export function paintedSplit(
  delivered: ReadonlySet<string>,
  specs: readonly AssetSpec[] = ART_MANIFEST,
): readonly PaintedClass[] {
  return ASSET_CLASSES.map((assetClass) => {
    const inClass = specs.filter((spec) => spec.class === assetClass);
    return {
      class: assetClass,
      painted: inClass.filter((spec) => delivered.has(spec.file)).map((spec) => spec.key),
      procedural: inClass.filter((spec) => !delivered.has(spec.file)).map((spec) => spec.key),
    };
  }).filter((row) => row.painted.length + row.procedural.length > 0);
}

/** {@link paintedSplit} as the CLI report — counts first, because that is what the board tracks. */
export function paintedReport(split: readonly PaintedClass[]): string {
  const total = split.reduce((n, row) => n + row.painted.length + row.procedural.length, 0);
  const painted = split.reduce((n, row) => n + row.painted.length, 0);
  const label = Math.max(...split.map((row) => row.class.length));

  const lines = [`painted ${painted}/${total}, procedural fallback ${total - painted}/${total}`];
  for (const row of split) {
    const count = `${row.painted.length}/${row.painted.length + row.procedural.length}`;
    lines.push(`  ${row.class.padEnd(label)}  ${count.padStart(6)}`);
    if (row.painted.length > 0) lines.push(`    painted: ${row.painted.join(', ')}`);
    if (row.procedural.length > 0) lines.push(`    procedural: ${row.procedural.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

async function readPaintedReport(outDir: string): Promise<string> {
  return paintedReport(paintedSplit(new Set(await readdir(outDir).catch(() => []))));
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

/** The subset of `specs` whose master has arrived, and what it arrived as. */
async function findMasters(
  specs: readonly AssetSpec[],
  masterDir: string,
): Promise<{ present: readonly Master[]; missing: readonly AssetSpec[] }> {
  const files = new Set(await readdir(masterDir).catch(() => []));
  const present: Master[] = [];
  const missing: AssetSpec[] = [];
  for (const spec of specs) {
    const file = masterFileFor(spec, files);
    if (file === undefined) missing.push(spec);
    else present.push({ spec, file });
  }
  return { present, missing };
}

export async function encodeAll(masters: readonly Master[], options: CliOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });
  for (const { spec, file } of masters) {
    const master = path.join(options.masterDir, file);
    // Named here rather than inside the encode: a `--landed` run walks the whole manifest, so
    // "which master" is the first thing a failure has to answer.
    const { bytes, transparency } = await encodeAsset(await readFile(master), spec, options).catch(
      (error: unknown) => {
        throw new Error(`${master} — ${errorMessage(error)}`);
      },
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

  if (options.painted) {
    process.stdout.write(await readPaintedReport(options.outDir));
    return 0;
  }

  let present: readonly Master[];
  let missing: readonly AssetSpec[];
  try {
    ({ present, missing } = await findMasters(specs, options.masterDir));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  if (options.dryRun) {
    process.stdout.write(
      `${POST_PROCESS_STEPS.length} post-process step(s) implemented; ${specs.length} asset(s) validated:\n`,
    );
    for (const { spec, file } of present) {
      process.stdout.write(`  ${file} → ${spec.file}  [${describePlan(spec)}]\n`);
    }
    if (missing.length > 0) {
      process.stdout.write(
        `${missing.length} master(s) not generated yet — run gen-art first: ${missing.map((s) => s.key).join(', ')}\n`,
      );
    }
    return 0;
  }

  if (missing.length > 0) {
    if (!options.landed) {
      process.stderr.write(
        `${missing.length} master(s) missing from ${options.masterDir}: ${missing.map((s) => s.key).join(', ')}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `${present.length}/${specs.length} master(s) landed; still waiting on ${missing.map((s) => s.key).join(', ')}\n`,
    );
  }

  try {
    await encodeAll(present, options);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  process.stdout.write(await readPaintedReport(options.outDir));
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
