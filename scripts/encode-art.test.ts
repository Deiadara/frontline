import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ART_MANIFEST,
  POST_PROCESS_STEPS,
  findAssetSpec,
  type AssetSpec,
  type PostProcessStep,
} from '@frontline/shared';
import {
  DEFAULT_ART_BIBLE_PATH,
  DEFAULT_ASSET_DIR,
  DEFAULT_MATTE_TOLERANCE,
  HUMAN_MATTE_FLOOR,
  MAX_ERASED_ARTWORK,
  MAX_KEYED_ISLANDS,
  auditDeliveries,
  auditProvenance,
  centredCrop,
  decodeMaster,
  encodeAsset,
  keyBackground,
  main,
  paintedReport,
  paintedSplit,
  parseArgs,
  parseLicensingRegister,
  postProcessorFor,
  transparencyOf,
  unimplementedSteps,
  type DeliveryProblem,
  type PaintedClass,
  type ProvenanceProblem,
} from './encode-art.js';

const spec = (key: string): AssetSpec => {
  const found = findAssetSpec(key);
  if (!found) throw new Error(`${key} is missing from the manifest`);
  return found;
};

/** The two shapes no backend renders directly — the whole reason `postProcess` exists. */
const ICON = spec('icon-scrap');
const FORE_PLANE = spec('plane-city-fore');
const FAR_PLANE = spec('plane-city-far');
/** A master that already is its delivery image. */
const DISTRICT = spec('district-chrome-row');

/**
 * Both audits list the drop directory through a `readdir(...).catch(() => [])`, which cannot tell
 * "nothing is wrong" from "there is no such directory". `assets/` holds only `README.md` today, so
 * the two gates below would go on passing against a directory that had been renamed away — and
 * they are the only cases that will ever see the board's real art. Anchor them to a file that is
 * really there, so the gate fails loudly instead of silently auditing nothing.
 */
async function expectDropDirectoryReal(): Promise<void> {
  await expect(readdir(DEFAULT_ASSET_DIR)).resolves.toContain('README.md');
}

const SKY: readonly [number, number, number, number] = [27, 34, 51, 255];
const SUBJECT: readonly [number, number, number, number] = [240, 200, 120, 255];

afterEach(() => {
  vi.restoreAllMocks();
});

type Rgba = readonly [number, number, number, number];

/** A PNG master painted pixel-by-pixel, so a test can state exactly what the encoder is handed. */
async function master(
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgba,
): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** An opaque master whose subject fills the bottom `subjectFraction` of the frame. */
const skyline = (width: number, height: number, subjectFraction: number) =>
  master(width, height, (_x, y) => (y >= height * (1 - subjectFraction) ? SUBJECT : SKY));

/** Deterministic per-channel grain in [-amplitude, amplitude]. */
function grain(index: number, amplitude: number): number {
  // Each shift-xor is re-cast with `>>> 0`: `^=` alone yields a *signed* int, and a negative hash
  // makes `%` negative, which silently widened this to [-3·amplitude, amplitude] (MOU-152).
  let hash = Math.imul(index, 2654435761) >>> 0;
  hash = (hash ^ (hash >>> 15)) >>> 0;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  return (hash % (2 * amplitude + 1)) - amplitude;
}

/**
 * Deterministic per-channel grain from an **unbounded** distribution: Box-Muller over a hashed
 * uniform pair, so it has the tail {@link grain} has none of.
 *
 * Every threshold in the matte is a fixed cut through a noise distribution the master never
 * declares, so one bounded generator cannot calibrate any of them — under `grain` alone a cut at
 * 2× the tolerance is never reached and reads as free of false positives, which is exactly how
 * `MAX_ERASED_ARTWORK` came to refuse a flawless key (MOU-125 round 3).
 */
function gaussianGrain(index: number, sigma: number): number {
  const unit = (n: number): number => {
    let hash = Math.imul(n + 1, 2654435761) >>> 0;
    hash = (hash ^ (hash >>> 15)) >>> 0;
    hash = Math.imul(hash, 2246822519) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
    // Offset off 0, so the log below never sees it.
    return (hash + 0.5) / 4294967296;
  };
  const radius = Math.sqrt(-2 * Math.log(unit(index * 2)));
  return Math.round(sigma * radius * Math.cos(2 * Math.PI * unit(index * 2 + 1)));
}

/** Per-channel noise as a function of the channel's index in the frame. */
type Noise = (index: number) => number;

/** `base` with `noise` on each channel, deterministic in the pixel index. */
function noisy(base: Rgba, pixel: number, noise: Noise): Rgba {
  const channel = (c: number): number =>
    Math.max(0, Math.min(255, base[c]! + noise(pixel * 3 + c)));
  return [channel(0), channel(1), channel(2), base[3]];
}

/**
 * {@link skyline} with per-pixel grain in the flat field — what a diffusion backend actually returns
 * when a prompt asks for a flat sky. Every `keyBackground` input used to be painted from two exact
 * constants, which is why a key that speckles on a grainy field passed every test.
 */
const noisySkyline = (
  width: number,
  height: number,
  subjectFraction: number,
  noise: Noise,
): Promise<Buffer> =>
  master(width, height, (x, y) =>
    noisy(y >= height * (1 - subjectFraction) ? SUBJECT : SKY, y * width + x, noise),
  );

/** {@link noisySkyline} under the bounded generator. */
const grainySkyline = (
  width: number,
  height: number,
  subjectFraction: number,
  amplitude: number,
): Promise<Buffer> =>
  noisySkyline(width, height, subjectFraction, (index) => grain(index, amplitude));

/** {@link noisySkyline} under the unbounded one — see {@link gaussianGrain}. */
const gaussianSkyline = (
  width: number,
  height: number,
  subjectFraction: number,
  sigma: number,
): Promise<Buffer> =>
  noisySkyline(width, height, subjectFraction, (index) => gaussianGrain(index, sigma));

/** The rows a {@link cabledPlane} runs its cable through, whatever it was painted at. */
const CABLE_TOP = 40;

/**
 * {@link grainySkyline} with a horizontal cable `stroke` px thick laid across the field — the
 * `plane-city-fore` prompt asks for "a bundle of sagging cable across the top", and how thin that
 * comes back is what decides whether the key can represent it at all.
 */
const cabledPlane = (
  width: number,
  height: number,
  stroke: number,
  noise: Noise = () => 0,
): Promise<Buffer> =>
  master(width, height, (x, y) => {
    const onCable = y >= CABLE_TOP && y < CABLE_TOP + stroke && x >= 8 && x < width - 8;
    const base = onCable || y >= height * 0.7 ? SUBJECT : SKY;
    return noisy(base, y * width + x, noise);
  });

/** The share of a {@link cabledPlane}'s cable that survived the key. */
function cableSurvival(image: { data: Buffer; width: number }, stroke: number): number {
  let opaque = 0;
  const cable = image.width - 16;
  for (let y = CABLE_TOP; y < CABLE_TOP + stroke; y += 1) {
    for (let x = 8; x < image.width - 8; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] !== 0) opaque += 1;
    }
  }
  return opaque / (cable * stroke);
}

/** The roofline {@link antennaPlane} stands its antennae on — the top row of a 0.7 subject block. */
const ROOFLINE = Math.ceil(1152 * 0.7);
const ANTENNA_LEFT = 16;
const ANTENNA_SPACING = 13;

/**
 * A 2048×1152 plane with `count` 1-px antennae `tall` px high along its roofline — the floating
 * antenna ART-BIBLE §6.2 names, at whatever height the caller wants to put against
 * {@link MAX_ERASED_ARTWORK}'s run floor.
 */
const antennaPlane = (count: number, tall: number): Promise<Buffer> =>
  master(2048, 1152, (x, y) => {
    const index = (x - ANTENNA_LEFT) / ANTENNA_SPACING;
    const onAntenna =
      Number.isInteger(index) &&
      index >= 0 &&
      index < count &&
      y >= ROOFLINE - tall &&
      y < ROOFLINE;
    return onAntenna || y >= ROOFLINE ? SUBJECT : SKY;
  });

/** The share of an {@link antennaPlane}'s antennae the key left standing. */
function antennaSurvival(image: { data: Buffer; width: number }, count: number, tall: number) {
  let opaque = 0;
  for (let index = 0; index < count; index += 1) {
    const x = ANTENNA_LEFT + index * ANTENNA_SPACING;
    for (let y = ROOFLINE - tall; y < ROOFLINE; y += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] !== 0) opaque += 1;
    }
  }
  return opaque / (count * tall);
}

/**
 * The noise a master may plausibly arrive carrying, from both generators. Every gate that cuts a
 * threshold through the field's deviation from its seed is walked across all three: one distribution
 * calibrates a threshold against its own shape and nothing else.
 */
const NOISES: readonly (readonly [string, Noise])[] = [
  ['clean', () => 0],
  ['±16 uniform grain', (index) => grain(index, 16)],
  ['σ12 Gaussian grain', (index) => gaussianGrain(index, 12)],
];

/** Rows of a 2048×1152 `grainySkyline(…, 0.3, …)` that are flat field rather than subject. */
const SKY_ROWS = Math.round(1152 * 0.7);

/** The share of the flat field left opaque — speckle the coverage-weighted §6 gate cannot see. */
function skySpeckle(image: { data: Buffer; width: number }, skyRows: number): number {
  let opaque = 0;
  for (let pixel = 0; pixel < image.width * skyRows; pixel += 1) {
    if (image.data[pixel * 4 + 3] !== 0) opaque += 1;
  }
  return opaque / (image.width * skyRows);
}

describe('post-process registry', () => {
  /** MOU-125 scope item 4: nothing the manifest declares may be silently skipped. */
  it('implements every step the manifest declares', () => {
    expect(unimplementedSteps(ART_MANIFEST)).toEqual([]);
  });

  it('implements every step in the shared POST_PROCESS_STEPS union', () => {
    for (const step of POST_PROCESS_STEPS) {
      expect(postProcessorFor(step), step).toBeTypeOf('function');
    }
  });

  it('is a hard failure, never a pass-through, for a step with no implementation', () => {
    expect(() => postProcessorFor('sharpen' as PostProcessStep)).toThrow(
      /no implementation for post-process step "sharpen"/,
    );
    expect(unimplementedSteps([{ ...ICON, postProcess: ['sharpen' as PostProcessStep] }])).toEqual([
      'sharpen',
    ]);
  });

  it('covers exactly the 15 assets MOU-123 left post-processed', () => {
    const pending = ART_MANIFEST.filter((s) => s.postProcess.length > 0);
    expect(pending).toHaveLength(15);
    expect(pending.filter((s) => s.postProcess.includes('downscale'))).toHaveLength(13);
    expect(pending.filter((s) => s.postProcess.includes('matte'))).toHaveLength(2);
  });
});

describe('keyBackground', () => {
  it('clears the background and keeps the subject', async () => {
    const image = await decodeMaster(
      await master(64, 64, (x, y) => (x >= 16 && x < 48 && y >= 16 && y < 48 ? SUBJECT : SKY)),
    );
    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);
    const alphaAt = (x: number, y: number): number => keyed.data[(y * 64 + x) * 4 + 3]!;

    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(32, 32)).toBe(255);
    // 64² canvas, 32² subject — three quarters keyed, plus the subject's four corner pixels: the
    // median the mask is decided on rounds a 90° corner by one pixel. Invisible on a 2048px plane.
    expect(transparencyOf(keyed)).toBeCloseTo((64 * 64 - (32 * 32 - 4)) / (64 * 64), 5);
  });

  it('keeps a sky-coloured window inside the subject — it is its own tiny region', async () => {
    const inSubject = (x: number, y: number): boolean => x >= 16 && x < 48 && y >= 16 && y < 48;
    // 4×4 of 64² is 0.4% of the canvas, under MIN_KEYED_REGION.
    const inWindow = (x: number, y: number): boolean => x >= 30 && x < 34 && y >= 30 && y < 34;
    const image = await decodeMaster(
      await master(64, 64, (x, y) => (inSubject(x, y) && !inWindow(x, y) ? SUBJECT : SKY)),
    );

    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);
    expect(keyed.data[(32 * 64 + 32) * 4 + 3]).toBe(255);
    expect(keyed.data[3]).toBe(0);
  });

  /** `plane-city-fore` is transparent through its centre and painted at the edges (ART-BIBLE §6). */
  it('keys a centre background the frame border never touches', async () => {
    const image = await decodeMaster(
      await master(64, 64, (x, y) => (x >= 6 && x < 58 && y >= 6 && y < 58 ? SKY : SUBJECT)),
    );
    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);

    expect(keyed.data[(32 * 64 + 32) * 4 + 3]).toBe(0);
    expect(keyed.data[3]).toBe(255);
    // The keyed centre likewise keeps its four corner pixels to the median's 1-px rounding.
    expect(transparencyOf(keyed)).toBeCloseTo((52 * 52 - 4) / (64 * 64), 5);
  });

  /**
   * The MOU-125 review's finding: per-pixel grain punches 1-px holes the region floor then keeps,
   * so a "transparent" sky ships full of opaque dots while the §6 transparency gate reads fine.
   */
  it('keys a grainy field as cleanly as a flat one', async () => {
    const image = await decodeMaster(await grainySkyline(2048, 1152, 0.3, 16));

    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);

    // The flat master keys to 70.0%: grain must neither eat the field nor stay behind in it.
    expect(transparencyOf(keyed)).toBeCloseTo(0.7, 2);
    expect(skySpeckle(keyed, SKY_ROWS)).toBeLessThan(0.001);
    expect(keyed.islands).toBe(1);
  });

  /**
   * The MOU-125 round-3 finding, and the reason {@link gaussianGrain} exists. There is no thin
   * structure anywhere in this master — a flat field over a solid block — and the key is flawless,
   * so nothing here may be reported as erased artwork. Under an unbounded distribution it was:
   * `isArtwork` is a fixed cut, every tail pixel of the field lands past it, and at σ 12 that made
   * a perfect key read 7,579 px erased and refused, telling the operator to fix a 1-px cable the
   * master does not have. `MIN_ERASED_RUN` is what separates dust from a structure.
   */
  it.each([8, 12, 16])('does not read grain as erased artwork — σ%i Gaussian', async (sigma) => {
    const keyed = await keyBackground(
      await decodeMaster(await gaussianSkyline(2048, 1152, 0.3, sigma)),
      DEFAULT_MATTE_TOLERANCE,
    );

    expect(transparencyOf(keyed)).toBeCloseTo(0.7, 2);
    expect(keyed.islands).toBe(1);
    expect(skySpeckle(keyed, SKY_ROWS)).toBeLessThan(0.001);
    expect(keyed.erased).toBeLessThanOrEqual(MAX_ERASED_ARTWORK);
  });

  /**
   * The invariant across the band from workable grain to hopeless: a speckled field is never
   * something the encoder hands back. Past the point where the noise floor beats `tolerance` the
   * misses stop being isolated pixels and clump into islands too big to sweep — which is the case
   * `MAX_KEYED_ISLANDS` refuses. At `DEFAULT_MATTE_TOLERANCE` the boundary measures between ±35
   * (47 islands, 0.29% speckle, ships) and ±36 (126 islands, 0.71% speckle, refused).
   *
   * Well past ±45 the master stops having a keyable field at all and the key cuts *nothing* — one
   * fully opaque island, which passes the island count. That case is `encodeAsset`'s to refuse
   * (it has a separate no-cut gate), so the levels here stay inside the band this gate governs.
   */
  it('keys clean or refuses at every grain level — it never ships speckle', async () => {
    const shipped: boolean[] = [];
    for (const amplitude of [35, 36, 40]) {
      const keyed = await keyBackground(
        await decodeMaster(await grainySkyline(2048, 1152, 0.3, amplitude)),
        DEFAULT_MATTE_TOLERANCE,
      );
      const ships = keyed.islands <= MAX_KEYED_ISLANDS;
      if (ships) expect(skySpeckle(keyed, SKY_ROWS), `±${amplitude}`).toBeLessThan(0.005);
      shipped.push(ships);
    }
    // Both outcomes have to occur, or a key that refused everything would satisfy this vacuously.
    expect(shipped).toContain(true);
    expect(shipped).toContain(false);
  });

  it('sweeps an opaque speck too small to be artwork, and keeps one that is big enough', async () => {
    // 3×3 = 9 px is under MIN_OPAQUE_ISLAND; 16×16 = 256 px is over it.
    const inBox = (x: number, y: number, left: number, size: number): boolean =>
      x >= left && x < left + size && y >= 8 && y < 8 + size;
    const image = await decodeMaster(
      await master(64, 64, (x, y) => (inBox(x, y, 4, 3) || inBox(x, y, 40, 16) ? SUBJECT : SKY)),
    );

    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);
    const alphaAt = (x: number, y: number): number => keyed.data[(y * 64 + x) * 4 + 3]!;
    expect(alphaAt(5, 9)).toBe(0);
    expect(alphaAt(47, 15)).toBe(255);
    expect(keyed.islands).toBe(1);
  });

  /**
   * The round-2 review's finding. The median the mask is decided on cannot represent a structure
   * thinner than its window: a 1-px line is 3 of the 9 samples in every window it touches, so the
   * median returns the field and the line is keyed away. `plane-city-fore` asks for exactly that
   * shape by name, and both other gates move the *wrong* way when it happens — deleting artwork
   * raises transparency past the §6 floor and lowers the island count.
   */
  it.each(NOISES)('keeps a cable as thick as the key window — %s', async (_label, noise) => {
    const image = await decodeMaster(await cabledPlane(2048, 1152, 2, noise));

    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);

    expect(cableSurvival(keyed, 2)).toBeGreaterThan(0.99);
    expect(keyed.erased).toBeLessThanOrEqual(MAX_ERASED_ARTWORK);
  });

  it.each(NOISES)('refuses a cable thinner than it — %s', async (_label, noise) => {
    // The plane canvas both matte assets are declared at, which is what MAX_ERASED_ARTWORK counts.
    const image = await decodeMaster(await cabledPlane(2048, 1152, 1, noise));

    const keyed = await keyBackground(image, DEFAULT_MATTE_TOLERANCE);

    // The cable goes wholesale, grain or none: it is only 3 of the 9 samples in every window it
    // touches, so the median returns the field at every level alike — 0% left, ~2030 px erased.
    // (The dashed line this used to record at ±16 was the skewed generator, not grain — MOU-152.)
    expect(cableSurvival(keyed, 1)).toBeLessThan(0.9);
    expect(keyed.erased).toBeGreaterThan(MAX_ERASED_ARTWORK);
    // Neither older gate sees it, which is why this one has to exist.
    expect(keyed.islands).toBeLessThanOrEqual(MAX_KEYED_ISLANDS);
    expect(transparencyOf(keyed)).toBeGreaterThan(0.55);
  });

  /**
   * The fourth blind spot, pinned as a known property so nobody re-derives it as coverage.
   * `MIN_ERASED_RUN` is what stops grain reading as erasure, and it buys that by counting only runs
   * of 16 or more — so an erasure in shorter runs is invisible, and *no number of them adds up*.
   * A 1-px antenna 14 px tall leaves a 12-px run, so this master loses 2,100 px of the structure
   * ART-BIBLE §6.2 exists to protect and every gate still reads clean. §6.2's minimum stroke weight
   * is the only cover; see `MIN_ERASED_RUN` for why no lower floor is available.
   */
  it('cannot see an erasure shorter than the run floor, however many there are', async () => {
    const keyed = await keyBackground(
      await decodeMaster(await antennaPlane(150, 14)),
      DEFAULT_MATTE_TOLERANCE,
    );

    // The antennae really are erased — the assertion below is a hole, not a key that kept them.
    expect(antennaSurvival(keyed, 150, 14)).toBeLessThan(0.1);
    expect(keyed.erased).toBe(0);
    // And nothing else catches it, so the master ships.
    expect(keyed.islands).toBeLessThanOrEqual(MAX_KEYED_ISLANDS);
    await expect(encodeAsset(await antennaPlane(150, 14), FORE_PLANE)).resolves.toBeDefined();

    // The cliff is the run floor and not the count: 18 px drawn leaves a 16-px run, and 40 of those
    // — a quarter of the structure this master loses — are refused.
    const taller = await keyBackground(
      await decodeMaster(await antennaPlane(40, 18)),
      DEFAULT_MATTE_TOLERANCE,
    );
    expect(taller.erased).toBeGreaterThan(MAX_ERASED_ARTWORK);
  });

  it('does not chase a gradient across the whole frame', async () => {
    // Seed-relative tolerance keeps the key inside the band nearest the dominant colour.
    const image = await decodeMaster(
      await master(64, 64, (_x, y) => [20, 20, Math.min(255, y * 4), 255]),
    );
    expect(transparencyOf(await keyBackground(image, DEFAULT_MATTE_TOLERANCE))).toBeLessThan(0.5);
  });
});

describe('encodeAsset', () => {
  it('downscales an icon master to its ART-BIBLE §6 delivery size, keeping alpha', async () => {
    // gpt-image-1 renders icons at 1024² with a real alpha channel; only the size needs closing.
    const bytes = await master(1024, 1024, (x, y) =>
      x >= 256 && x < 768 && y >= 256 && y < 768 ? SUBJECT : [0, 0, 0, 0],
    );

    const { bytes: delivery, transparency } = await encodeAsset(bytes, ICON);
    const meta = await sharp(delivery).metadata();
    expect({ width: meta.width, height: meta.height, format: meta.format }).toEqual({
      width: 512,
      height: 512,
      format: 'webp',
    });
    expect(meta.hasAlpha).toBe(true);
    // The transparent three quarters survive the resample.
    expect(transparency).toBeCloseTo(0.75, 2);
  });

  it('mattes an opaque plane master and reports the transparency it achieved', async () => {
    const { transparency, bytes } = await encodeAsset(await skyline(2048, 1152, 0.3), FORE_PLANE);
    expect(transparency).toBeCloseTo(0.7, 2);
    expect((await sharp(bytes).metadata()).hasAlpha).toBe(true);
  });

  it('fails rather than shipping a fore plane under the ART-BIBLE §6 transparency floor', async () => {
    // Sky over the top 30% only; the painted 70% below it carries no single dominant colour.
    const bytes = await master(2048, 1152, (x, y) =>
      y < 1152 * 0.3 ? SKY : [90, (x * 7 + y * 13) % 256, 20, 255],
    );
    await expect(encodeAsset(bytes, FORE_PLANE)).rejects.toThrow(
      /transparent, ART-BIBLE §6 requires at least 55\.0%/,
    );
  });

  it('refuses a grainier master than the tolerance covers, and takes a wider one', async () => {
    // ±40 grain against tolerance 18: the key misses in clumps rather than isolated pixels, and it
    // used to ship — 62% transparent clears the §6 floor while a tenth of the sky stays opaque.
    const bytes = await grainySkyline(2048, 1152, 0.3, 40);

    await expect(encodeAsset(bytes, FORE_PLANE)).rejects.toThrow(/disconnected pieces/);

    // The remedy the failure names has to actually work, or it is not a remedy.
    const { transparency } = await encodeAsset(bytes, FORE_PLANE, { matteTolerance: 32 });
    expect(transparency).toBeCloseTo(0.7, 2);
  });

  it('refuses a plane whose artwork is thinner than the key window, and takes the same plane thicker', async () => {
    await expect(encodeAsset(await cabledPlane(2048, 1152, 1), FORE_PLANE)).rejects.toThrow(
      /thinner than the 3px key window/,
    );

    // Same layout, cable at the stroke weight the key can represent: nothing else about it changed.
    const { transparency } = await encodeAsset(await cabledPlane(2048, 1152, 3), FORE_PLANE);
    expect(transparency).toBeCloseTo(0.7, 2);
  });

  it('fails when the matte cuts nothing — an opaque "transparent" plane is a browser bug', async () => {
    // Pure noise: no flat field, so every matching region falls under MIN_KEYED_REGION.
    const bytes = await master(2048, 1152, (x, y) => [
      (x * 13 + y * 7) % 256,
      (x * 5 + y * 11) % 256,
      (x * 3 + y * 17) % 256,
      255,
    ]);
    await expect(encodeAsset(bytes, FAR_PLANE)).rejects.toThrow(/the matte cut nothing/);
  });

  it('fails when the matte cuts the whole frame rather than shipping an empty plane', async () => {
    await expect(encodeAsset(await skyline(2048, 1152, 0), FAR_PLANE)).rejects.toThrow(
      /the matte cut the entire frame/,
    );
  });

  it('keeps a hand-matted master instead of keying over it (ADR 0001 §6.4)', async () => {
    // No flat keyable border here — a flood key would cut nothing and fail. The human's alpha wins.
    const bytes = await master(2048, 1152, (x, y) => [90, (x * y) % 256, 20, y < 461 ? 255 : 0]);
    const { transparency } = await encodeAsset(bytes, FORE_PLANE);
    expect(transparency).toBeCloseTo(0.6, 2);
    expect(transparency).toBeGreaterThan(HUMAN_MATTE_FLOOR);
  });

  it('encodes a no-post-process master straight to its delivery format, opaque', async () => {
    const bytes = await skyline(1024, 1024, 0.5);
    const { bytes: delivery, transparency } = await encodeAsset(bytes, DISTRICT);
    const meta = await sharp(delivery).metadata();
    expect({ width: meta.width, height: meta.height, format: meta.format }).toEqual({
      width: 1024,
      height: 1024,
      format: 'webp',
    });
    expect(meta.hasAlpha).toBe(false);
    expect(transparency).toBe(0);
  });

  it('refuses a transparent master on a key that delivers no alpha (MOU-374)', async () => {
    // What MOU-317 established about `removeAlpha()` is what makes this a rejection rather than a
    // flatten: it *discards* the band instead of compositing, so the RGB under `alpha = 0` ships
    // untouched — `[240,200,120]` here, and black for a real master that painted nothing there.
    // Nothing downstream sees it either: `minTransparency` is attached to the two planes only, and
    // `postProcessFor` never declares `matte` for an opaque delivery, so both of the gates above
    // are structurally inert on exactly the keys the board's masters land on. `district` is one.
    const bytes = await master(1024, 1024, (x, y) => [240, 200, 120, y < 512 ? 255 : 0]);

    // Stated first: if the fixture is not actually transparent going in, the rejection below could
    // pass for a reason that has nothing to do with alpha.
    expect(transparencyOf(await decodeMaster(bytes))).toBe(0.5);
    await expect(encodeAsset(bytes, DISTRICT)).rejects.toThrow(
      /carries alpha over 50\.0% of the frame but "district" delivers none/,
    );
  });

  it('refuses a master that is not the resolution the manifest declared', async () => {
    await expect(encodeAsset(await skyline(512, 512, 0.5), ICON)).rejects.toThrow(
      /master is 512×512, which centre-crops to 512×512 .* upscaling invents detail/s,
    );
  });
});

/**
 * A CC0 master is whatever size its uploader saved, in whatever aspect they framed it — so the
 * encode brings the shape to the manifest rather than refusing everything that is not already
 * exact (MOU-229 D1).
 */
describe('normalizeMaster', () => {
  const size = async (bytes: Uint8Array) => {
    const meta = await sharp(bytes).metadata();
    return { width: meta.width, height: meta.height };
  };

  it('takes the largest centred rectangle of the declared aspect', () => {
    // Master wider than 1:1 → the full height survives and the sides are trimmed evenly.
    expect(centredCrop({ width: 1600, height: 1000 }, { width: 512, height: 512 })).toEqual({
      left: 300,
      top: 0,
      width: 1000,
      height: 1000,
    });
    // Master taller than 16:9 → the full width survives.
    expect(centredCrop({ width: 1920, height: 1920 }, { width: 2048, height: 1152 })).toEqual({
      left: 0,
      top: 420,
      width: 1920,
      height: 1080,
    });
    // Already the declared aspect: nothing to trim, at either size.
    expect(centredCrop({ width: 4096, height: 2304 }, { width: 2048, height: 1152 })).toEqual({
      left: 0,
      top: 0,
      width: 4096,
      height: 2304,
    });
  });

  it('crops and downscales an oversized master in the wrong aspect to the delivery size', async () => {
    // 3000×2000 for a 512² icon delivered off a 1024² source: 3:2, so 500px goes off each side.
    // Painting exactly that centred square opaque makes a miss loud rather than plausible — an
    // edge-aligned crop of the same size reads 25% transparent, an uncropped squash 33%.
    const bytes = await master(3000, 2000, (x) => (x >= 500 && x < 2500 ? SUBJECT : [0, 0, 0, 0]));

    const { bytes: delivery, transparency } = await encodeAsset(bytes, ICON);

    expect(await size(delivery)).toEqual({ width: 512, height: 512 });
    expect(transparency).toBeCloseTo(0, 2);
  });

  it('downscales a master that is oversized but already the right aspect', async () => {
    const { bytes: delivery } = await encodeAsset(await skyline(4096, 4096, 0.5), DISTRICT);
    expect(await size(delivery)).toEqual({ width: 1024, height: 1024 });
  });

  it('mattes at the manifest source size, so the §6 gates keep the canvas they were measured on', async () => {
    // 4096×2304 is 16:9 already; without a normalize the plane's gates would run on 4× the pixels.
    const { transparency, bytes } = await encodeAsset(await skyline(4096, 2304, 0.3), FORE_PLANE);
    expect(await size(bytes)).toEqual({ width: 2048, height: 1152 });
    expect(transparency).toBeCloseTo(0.7, 2);
  });

  it('refuses to upscale, naming the file, its size and the size it needs', async () => {
    // 1600×900 crops to 1600×900 (already 16:9) — short of the 2048×1152 source in both axes.
    await expect(encodeAsset(await skyline(1600, 900, 0.3), FORE_PLANE)).rejects.toThrow(
      /plane-city-fore: master is 1600×900, which centre-crops to 1600×900 at the manifest's 2048×1152 source aspect .* smallest one that works is 2048×1152\./s,
    );
  });

  it('refuses a master that is only short after the crop', async () => {
    // 4000×1000 is far wider than 16:9: the crop keeps the full 1000px height, which is short.
    await expect(encodeAsset(await skyline(4000, 1000, 0.3), FORE_PLANE)).rejects.toThrow(
      /master is 4000×1000, which centre-crops to 1777×1000 .* is 4608×1152\./s,
    );
  });
});

describe('parseArgs', () => {
  it('defaults to a real run over the whole manifest', () => {
    expect(parseArgs([])).toMatchObject({
      dryRun: false,
      only: [],
      matteTolerance: DEFAULT_MATTE_TOLERANCE,
    });
  });

  it('reads the flags a first funded run needs', () => {
    expect(
      parseArgs(['--dry-run', '--only', 'icon-scrap,plane-city-fore', '--matte-tolerance', '32']),
    ).toMatchObject({
      dryRun: true,
      only: ['icon-scrap', 'plane-city-fore'],
      matteTolerance: 32,
    });
  });

  it('rejects a missing value, an unknown flag and an out-of-range tolerance', () => {
    expect(() => parseArgs(['--only'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--sharpen', '3'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--matte-tolerance', '900'])).toThrow(/integer 0–255/);
  });

  // `--only "$KEY"` with an unset variable used to select nothing, which selected everything.
  it('rejects an --only that names no key instead of reading it as the whole manifest', () => {
    expect(() => parseArgs(['--only', ''])).toThrow(/selected no asset keys/);
    expect(() => parseArgs(['--only', ',,'])).toThrow(/selected no asset keys/);
    // Per --only, not per run: an earlier good selector must not absorb a later empty one.
    expect(() => parseArgs(['--only', 'icon-scrap', '--only', ''])).toThrow(
      /selected no asset keys/,
    );
  });
});

/** Each case gets its own master + delivery directory; nothing here touches the repo's own. */
async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontline-encode-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Separate master and delivery directories. A WebP master is `<key>.webp`, which for most classes
 * is byte-for-byte the delivery's own file name — sharing one directory would have the encode
 * overwrite its own input.
 */
async function withSplitDirs(body: (masters: string, out: string) => Promise<void>): Promise<void> {
  await withTempDir(async (dir) => {
    const masters = path.join(dir, 'art-src');
    const out = path.join(dir, 'assets');
    await mkdir(masters);
    await mkdir(out);
    await body(masters, out);
  });
}

const captured = (spy: { mock: { calls: readonly unknown[][] } }): string =>
  spy.mock.calls.map((call) => String(call[0])).join('');

describe('main', () => {
  it('dry-runs clean against an empty master directory and names what is missing', async () => {
    await withTempDir(async (dir) => {
      const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      expect(await main(['--dry-run', '--masters', dir, '--out', dir])).toBe(0);
      expect(captured(out)).toContain('45 asset(s) validated');
      expect(captured(out)).toContain('45 master(s) not generated yet');
    });
  });

  it('encodes a master end to end into the drop directory', async () => {
    await withTempDir(async (dir) => {
      const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      await writeFile(path.join(dir, `${FORE_PLANE.key}.png`), await skyline(2048, 1152, 0.3));

      expect(await main(['--only', FORE_PLANE.key, '--masters', dir, '--out', dir])).toBe(0);

      const meta = await sharp(await readFile(path.join(dir, FORE_PLANE.file))).metadata();
      expect({ width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha }).toEqual({
        width: 2048,
        height: 1152,
        hasAlpha: true,
      });
      expect(captured(out)).toContain('matte, 70.1% transparent');
    });
  });

  it('reports a missing master rather than half-encoding a run', async () => {
    await withTempDir(async (dir) => {
      const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      expect(await main(['--only', 'icon-scrap', '--masters', dir, '--out', dir])).toBe(1);
      expect(captured(err)).toContain('1 master(s) missing');
    });
  });

  // A CC0 archive serves whatever its uploader saved, and WebP is most of them.
  it('encodes a WebP master as readily as a PNG one', async () => {
    await withSplitDirs(async (masters, dir) => {
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const png = await master(2048, 2048, () => SKY);
      await writeFile(
        path.join(masters, `${DISTRICT.key}.webp`),
        await sharp(png).webp().toBuffer(),
      );

      expect(await main(['--only', DISTRICT.key, '--masters', masters, '--out', dir])).toBe(0);

      // 2048² normalizes down to the manifest's 1024² source, so this exercises decode + crop.
      const meta = await sharp(await readFile(path.join(dir, DISTRICT.file))).metadata();
      expect({ width: meta.width, height: meta.height }).toEqual({ width: 1024, height: 1024 });
      expect(captured(stdout)).toContain(DISTRICT.file);
    });
  });

  it('refuses a key that has masters at both extensions rather than picking one', async () => {
    await withSplitDirs(async (masters, dir) => {
      const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      const png = await master(1024, 1024, () => SKY);
      await writeFile(path.join(masters, `${DISTRICT.key}.png`), png);
      await writeFile(
        path.join(masters, `${DISTRICT.key}.webp`),
        await sharp(png).webp().toBuffer(),
      );

      expect(await main(['--only', DISTRICT.key, '--masters', masters, '--out', dir])).toBe(1);
      expect(captured(err)).toContain(
        `${DISTRICT.key}: masters at ${DISTRICT.key}.png and ${DISTRICT.key}.webp`,
      );
      // Nothing was written: the run stops before the encode, not part-way through it.
      await expect(readFile(path.join(dir, DISTRICT.file))).rejects.toThrow();
    });
  });

  it('names the master file a failing encode came from', async () => {
    await withTempDir(async (dir) => {
      const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      await writeFile(path.join(dir, `${FORE_PLANE.key}.png`), await skyline(1600, 900, 0.3));

      expect(await main(['--only', FORE_PLANE.key, '--masters', dir, '--out', dir])).toBe(1);
      expect(captured(err)).toContain(path.join(dir, `${FORE_PLANE.key}.png`));
      expect(captured(err)).toContain('upscaling invents detail');
    });
  });

  // The hero set is hand-pasted in batches, so most of the manifest is legitimately absent between
  // them — `--landed` is what lets an import run at all before the last file arrives.
  it('encodes the batch that has landed and names what it is still waiting on', async () => {
    await withTempDir(async (dir) => {
      const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
      await writeFile(path.join(dir, `${DISTRICT.key}.png`), await master(1024, 1024, () => SKY));

      expect(await main(['--landed', '--masters', dir, '--out', dir])).toBe(0);

      await expect(readFile(path.join(dir, DISTRICT.file))).resolves.toBeInstanceOf(Buffer);
      expect(captured(out)).toContain('1/45 master(s) landed');
      expect(captured(out)).toContain('still waiting on');
      expect(captured(err)).toBe('');
    });
  });
});

/**
 * What the game renders, which `--landed` does not answer: that reports masters in `art-src/`, and
 * a master can land and then fail its matte (MOU-229 D2).
 */
describe('painted vs procedural', () => {
  const keys = (split: readonly PaintedClass[], assetClass: string) =>
    split.find((row) => row.class === assetClass);

  it('splits every manifest key by whether its delivery file is on disk', () => {
    const split = paintedSplit(new Set([DISTRICT.file, ICON.file]));

    expect(keys(split, 'district')?.painted).toEqual([DISTRICT.key]);
    expect(keys(split, 'district')?.procedural).not.toContain(DISTRICT.key);
    expect(keys(split, 'icon')?.painted).toEqual([ICON.key]);
    // Every key lands on exactly one side, and no class is silently dropped.
    const counted = split.flatMap((row) => [...row.painted, ...row.procedural]);
    expect(counted.sort()).toEqual(ART_MANIFEST.map((s) => s.key).sort());
  });

  it('does not count a @2x delivery as painted — the client falls back to 1×, not up to it', () => {
    const retina = DISTRICT.file.replace(/\.(\w+)$/, '@2x.$1');
    expect(keys(paintedSplit(new Set([retina])), 'district')?.painted).toEqual([]);
  });

  it('reports counts per class ahead of the key lists', () => {
    const report = paintedReport(paintedSplit(new Set([DISTRICT.file])));
    expect(report.split('\n')[0]).toBe(
      `painted 1/${ART_MANIFEST.length}, procedural fallback ${ART_MANIFEST.length - 1}/${ART_MANIFEST.length}`,
    );
    expect(report).toContain(`painted: ${DISTRICT.key}`);
    expect(report).toMatch(/^ {2}district {2}\s*1\/\d+$/m);
  });

  it('reports standalone without encoding anything, and again after a run', async () => {
    await withTempDir(async (dir) => {
      const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

      expect(await main(['--painted', '--masters', dir, '--out', dir])).toBe(0);
      expect(captured(out)).toContain(`painted 0/${ART_MANIFEST.length}`);

      out.mockClear();
      await writeFile(path.join(dir, `${DISTRICT.key}.png`), await master(1024, 1024, () => SKY));
      expect(await main(['--only', DISTRICT.key, '--masters', dir, '--out', dir])).toBe(0);
      // The run's own delivery is counted, so the fraction moves in the same output.
      expect(captured(out)).toContain(`painted 1/${ART_MANIFEST.length}`);
    });
  });
});

/**
 * The drop directory is a second, unencoded way in: a CC0 file saved straight into `assets/` is
 * globbed by name and never passes `encodeAsset`, so the §6 floor has to be re-applied to what is
 * actually on disk. `plane-city-fore` draws in front of the district nodes, so an opaque one there
 * erases the playfield with every other gate green (MOU-289).
 */
describe('delivery audit', () => {
  const CLEAR: Rgba = [0, 0, 0, 0];

  /** A plane delivery whose top `clearRows` of 40 are transparent — each row is 2.5% of the frame. */
  const planeDelivery = async (clearRows: number): Promise<Buffer> =>
    sharp(await master(40, 40, (_x, y) => (y < clearRows ? CLEAR : SUBJECT)))
      .webp({ lossless: true, alphaQuality: 100 })
      .toBuffer();

  const auditWith = async (files: Record<string, Buffer>): Promise<readonly DeliveryProblem[]> => {
    let problems: readonly DeliveryProblem[] = [];
    await withTempDir(async (dir) => {
      for (const [name, bytes] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await writeFile(path.join(dir, name), bytes);
      }
      problems = await auditDeliveries(dir);
    });
    return problems;
  };

  it('rejects an opaque fore delivery — the failure that blanks the whole map', async () => {
    const problems = await auditWith({ [FORE_PLANE.file]: await planeDelivery(0) });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: FORE_PLANE.file, key: FORE_PLANE.key });
    expect(problems[0]?.problem).toContain('requires at least 55.0%');
  });

  it('rejects a fore delivery matted over too small a band, not just a fully opaque one', async () => {
    // 50% transparent: a plausible hand-matte that keyed the sky and left the skyline solid.
    const problems = await auditWith({ [FORE_PLANE.file]: await planeDelivery(20) });
    expect(problems.map((p) => p.key)).toEqual([FORE_PLANE.key]);
  });

  it('accepts a fore delivery that meets the declared floor exactly', async () => {
    expect(await auditWith({ [FORE_PLANE.file]: await planeDelivery(22) })).toEqual([]);
  });

  it('audits the @2x delivery too — retina resolves to it instead of the 1×', async () => {
    const retina = FORE_PLANE.file.replace(/\.(\w+)$/, '@2x.$1');
    const problems = await auditWith({ [retina]: await planeDelivery(0) });

    expect(problems.map((p) => p.file)).toEqual([retina]);
    expect(problems[0]?.key).toBe(FORE_PLANE.key);
  });

  it('leaves a plane the bible declares opaque alone', async () => {
    // `plane-city-sky` is the backdrop and carries no floor; auditing it would reject correct art.
    const sky = spec('plane-city-sky');
    expect(sky.minTransparency).toBeUndefined();
    expect(await auditWith({ [sky.file]: await planeDelivery(0) })).toEqual([]);
  });

  it('ignores files that match no manifest delivery', async () => {
    expect(await auditWith({ 'README.md': Buffer.from('# not art\n') })).toEqual([]);
  });

  it('reaches a delivery dropped in a subdirectory — the client glob does', async () => {
    // `source.ts` globs `assets/**` and keys on the base name, so a batch folder still ships.
    const nested = `batch-3/${FORE_PLANE.file}`;
    const problems = await auditWith({ [nested]: await planeDelivery(0) });
    expect(problems.map((p) => p.file)).toEqual([nested]);
  });

  it('names a governed delivery it cannot decode instead of throwing bare from sharp', async () => {
    // A truncated download under a correct name. sharp's own error carries neither, and the
    // contact sheet runs this audit — one unreadable file must not take the whole report down.
    const problems = await auditWith({ [FORE_PLANE.file]: Buffer.from('not an image at all') });

    expect(problems.map((p) => p.file)).toEqual([FORE_PLANE.file]);
    expect(problems[0]?.key).toBe(FORE_PLANE.key);
    expect(problems[0]?.problem).toContain('could not be read as an image');
  });

  // The gate itself: whatever is in `assets/` right now has to satisfy its declared floor.
  it('passes against the committed drop directory', async () => {
    await expectDropDirectoryReal();
    expect(await auditDeliveries()).toEqual([]);
  });
});

/**
 * The §6 floor above is audited against the drop directory; the §9 licence rule next to it was
 * enforced by prose alone. A correctly-named `.webp` saved straight into `assets/` renders with no
 * recorded provenance and every gate green — the board rule says it must not ship (MOU-296).
 */
describe('provenance audit', () => {
  const HEADER =
    '| File | Source | Author | Licence | Commercial OK | Attribution required | Added | Notes |\n' +
    '| ---- | ------ | ------ | ------- | ------------- | -------------------- | ----- | ----- |\n';

  /** A bible whose §9 table holds exactly `rows`, sandwiched between its real neighbours. */
  const bibleWith = (rows: readonly string[]): string =>
    `## 8. Motion and feel\n\ntext\n\n## 9. Licensing register\n\n${HEADER}${rows.join('\n')}\n\n### 9.1 Rules\n\n- a rule\n\n## 10. Rejection checklist\n\n- [ ] item\n`;

  const row = (file: string, ...rest: readonly string[]): string =>
    `| ${file} | ${[...rest, '', '', '', '', '', '', ''].slice(0, 7).join(' | ')} |`;

  const LICENSED = row('plate-city.webp', 'https://example.test/x', 'A. Painter', 'CC0');

  const auditWith = async (
    files: readonly string[],
    rows: readonly string[],
  ): Promise<readonly ProvenanceProblem[]> => {
    let problems: readonly ProvenanceProblem[] = [];
    await withTempDir(async (dir) => {
      // The bytes are never decoded — this gate reads the register, not the pixels.
      for (const name of files) {
        await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
        await writeFile(path.join(dir, name), 'not really an image');
      }
      const biblePath = path.join(dir, 'ART-BIBLE.md');
      await writeFile(biblePath, bibleWith(rows));
      problems = await auditProvenance(dir, biblePath);
    });
    return problems;
  };

  it('rejects a delivery with no §9 row — the hand-drop route nothing else looks at', async () => {
    const problems = await auditWith(
      ['plate-city.webp'],
      [LICENSED.replace('plate-city', 'other')],
    );

    expect(problems.map((p) => p.file)).toEqual(['plate-city.webp']);
    expect(problems[0]?.problem).toContain('no ART-BIBLE §9 licensing row');
  });

  it('accepts a delivery whose row names a source, an author and a licence', async () => {
    expect(await auditWith(['plate-city.webp'], [LICENSED])).toEqual([]);
  });

  it('rejects a row that names the file and nothing else', async () => {
    const problems = await auditWith(['plate-city.webp'], [row('plate-city.webp')]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.problem).toContain('Source, Author, Licence blank');
  });

  it('names only the columns actually left blank', async () => {
    const problems = await auditWith(
      ['plate-city.webp'],
      [row('plate-city.webp', 'https://example.test/x', '', 'CC0')],
    );
    expect(problems[0]?.problem).toContain('Author blank');
  });

  it('covers the @2x density off the 1× row — one artwork is one licence', async () => {
    expect(await auditWith(['plate-city.webp', 'plate-city@2x.webp'], [LICENSED])).toEqual([]);
  });

  it('rejects a misnamed drop too — inert in the browser, still a file in the repo', async () => {
    // Matches no manifest delivery, so the client never renders it and the §6 audit skips it.
    const problems = await auditWith(['some-photo.png'], [LICENSED]);
    expect(problems.map((p) => p.file)).toEqual(['some-photo.png']);
  });

  it('ignores the directory README and other non-image files', async () => {
    expect(await auditWith(['README.md', 'plate-city.provenance.json'], [])).toEqual([]);
  });

  it('reaches a drop in a subdirectory, and matches its row on the base name', async () => {
    expect(await auditWith(['batch-3/plate-city.webp'], [LICENSED])).toEqual([]);
    expect((await auditWith(['batch-3/plate-city.webp'], [])).map((p) => p.file)).toEqual([
      'batch-3/plate-city.webp',
    ]);
  });

  it('fails closed when §9 has no table at all', async () => {
    const bible = '## 9. Licensing register\n\nprose only\n\n## 10. Rejection checklist\n';
    let problems: readonly ProvenanceProblem[] = [];
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, 'plate-city.webp'), 'x');
      const biblePath = path.join(dir, 'ART-BIBLE.md');
      await writeFile(biblePath, bible);
      problems = await auditProvenance(dir, biblePath);
    });
    expect(problems.map((p) => p.file)).toEqual(['plate-city.webp']);
  });

  describe('register parsing', () => {
    it('skips the header and separator rows', () => {
      expect(parseLicensingRegister(bibleWith([LICENSED]))).toEqual([
        { file: 'plate-city.webp', blank: [] },
      ]);
    });

    it('strips backticks, so `plate-city.webp` matches the file on disk', () => {
      const rows = parseLicensingRegister(bibleWith([row('`plate-city.webp`', 'u', 'a', 'CC0')]));
      expect(rows.map((r) => r.file)).toEqual(['plate-city.webp']);
    });

    it('stops at §10 and does not read the rejection checklist as rows', () => {
      const bible = `${bibleWith([LICENSED])}\n| not | a | licence | row |\n`;
      expect(parseLicensingRegister(bible).map((r) => r.file)).toEqual(['plate-city.webp']);
    });

    // Against the real document, prettier-padded cells and all — a parser that silently found
    // nothing there would pass every gate above while enforcing nothing.
    it('finds rows in the committed ART-BIBLE §9 table', async () => {
      const rows = parseLicensingRegister(await readFile(DEFAULT_ART_BIBLE_PATH, 'utf8'));

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.file !== '' && !/^:?-+:?$/.test(r.file))).toBe(true);
    });
  });

  // The gate itself: every image sitting in `assets/` right now has a filled-in §9 row.
  it('passes against the committed drop directory', async () => {
    await expectDropDirectoryReal();
    expect(await auditProvenance()).toEqual([]);
  });
});
