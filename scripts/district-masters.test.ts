import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  BUILDING_KINDS,
  findAssetSpec,
  tryResolveAssetKey,
  type BuildingKind,
} from '@frontline/shared';
import {
  GRADE_LUMINANCE_PULL,
  GRADE_SATURATION_PULL,
  MAX_BRIGHTEN,
  STRUCTURE_ASPECT,
  STRUCTURE_GRADE,
} from '../apps/client/src/features/base/masters.js';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `apps/client/.../masters.ts` is a table of measurements of the delivered art, and a table of
 * measurements is worth nothing unless something re-measures it.
 *
 * The client cannot: it would have to decode twelve images to a canvas at start-up to recover
 * numbers that change only when a master does. This package already has libvips, so the check lives
 * here — and its failure message is the fix, because the table is generated, not judged.
 *
 * Both halves matter and they fail differently. A stale **aspect** puts a building in a box that is
 * the wrong shape, which shows up as dead hit area over a roof and a name plate floating off the
 * building — invisible in a screenshot. A stale **grade** puts it a stop out of the painting's
 * light, which is visible, but only if somebody happens to look at that one plot.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(REPO_ROOT, 'assets');

interface Tone {
  width: number;
  height: number;
  /** Mean luminance of the opaque pixels, 0–255. */
  lum: number;
  /** Mean HSV saturation of the opaque pixels, 0–1. */
  sat: number;
}

/**
 * Measured over the **opaque** pixels only.
 *
 * A cutout is mostly nothing. Averaging the transparent field in would drag every structure's mean
 * toward whatever RGB happens to sit under the alpha, which is a property of the encoder rather
 * than of the drawing.
 */
async function tone(file: string): Promise<Tone> {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (index: number): number => data[index] ?? 0;
  let opaque = 0;
  let lum = 0;
  let sat = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (at(i * channels + 3) < 200) continue;
    const r = at(i * channels);
    const g = at(i * channels + 1);
    const b = at(i * channels + 2);
    const max = Math.max(r, g, b);
    opaque += 1;
    lum += 0.299 * r + 0.587 * g + 0.114 * b;
    sat += max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  }
  return { width, height, lum: lum / opaque, sat: sat / opaque };
}

async function deliveredPath(kind: BuildingKind): Promise<string | null> {
  const key = tryResolveAssetKey({ type: 'building', building: kind });
  const spec = key === undefined ? undefined : findAssetSpec(key);
  if (!spec) return null;
  const file = path.join(ASSET_DIR, spec.file);
  return (await readFile(file).catch(() => null)) === null ? null : file;
}

const round = (value: number): number => Math.round(value * 100) / 100;

describe('the delivered structure masters', () => {
  const measured = new Map<BuildingKind, Tone>();
  let plate: Tone | undefined;

  beforeAll(async () => {
    for (const kind of BUILDING_KINDS) {
      const file = await deliveredPath(kind);
      if (file !== null) measured.set(kind, await tone(file));
    }
    const spec = findAssetSpec('plate-district');
    if (spec) {
      const file = path.join(ASSET_DIR, spec.file);
      if ((await readFile(file).catch(() => null)) !== null) plate = await tone(file);
    }
  }, 60_000);

  /**
   * Every structure whose master has landed is measured. The ones that have not are skipped rather
   * than failed — an undelivered structure falls back to its procedural sprite, which needs neither
   * an aspect nor a grade — but the skip is announced, so a suite that has quietly stopped checking
   * anything cannot pass for a suite that checked everything.
   */
  it('has masters to measure', () => {
    expect(plate, 'plate-district has not been delivered — nothing to grade against').toBeDefined();
    expect(measured.size, 'no structure master has been delivered').toBeGreaterThan(0);
    if (measured.size < BUILDING_KINDS.length) {
      const missing = BUILDING_KINDS.filter((kind) => !measured.has(kind));
      process.stdout.write(`  (not yet delivered, so unmeasured: ${missing.join(', ')})\n`);
    }
  });

  it('matches the aspect STRUCTURE_ASPECT declares for it', () => {
    for (const [kind, art] of measured) {
      expect(STRUCTURE_ASPECT[kind], `${kind}: master is ${art.width}×${art.height}`).toBeCloseTo(
        art.width / art.height,
        1,
      );
    }
  });

  /**
   * The delivery is cropped to its own artwork — the manifest's `trim` step.
   *
   * Without it a structure's file is its drawing plus however much empty canvas the illustrator
   * left, which ran from 11px to 105px under the feet. A scene that stands buildings on a ground
   * line has no way to know which, so a bottom-aligned row of them stands at eleven heights.
   */
  it('ships cropped to its own artwork, with no empty canvas around it', async () => {
    for (const kind of measured.keys()) {
      const file = await deliveredPath(kind);
      if (file === null) continue;
      const { data, info } = await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const alpha = (x: number, y: number): number =>
        data[(y * info.width + x) * info.channels + 3] ?? 0;
      const rowHas = (y: number): boolean => {
        for (let x = 0; x < info.width; x += 1) if (alpha(x, y) >= 8) return true;
        return false;
      };
      const colHas = (x: number): boolean => {
        for (let y = 0; y < info.height; y += 1) if (alpha(x, y) >= 8) return true;
        return false;
      };
      expect(rowHas(0), `${kind}: blank row at the top`).toBe(true);
      expect(rowHas(info.height - 1), `${kind}: blank row under its feet`).toBe(true);
      expect(colHas(0), `${kind}: blank column on the left`).toBe(true);
      expect(colHas(info.width - 1), `${kind}: blank column on the right`).toBe(true);
    }
  }, 60_000);

  it('carries the grade its own tone and the plate imply', () => {
    for (const [kind, art] of measured) {
      const brightness = round(
        Math.min(MAX_BRIGHTEN, 1 + GRADE_LUMINANCE_PULL * ((plate?.lum ?? 0) / art.lum - 1)),
      );
      const saturate = round(1 + GRADE_SATURATION_PULL * ((plate?.sat ?? 0) / art.sat - 1));
      expect(STRUCTURE_GRADE[kind], kind).toEqual({ brightness, saturate });
    }
  });

  /**
   * And the grade actually closes the gap it exists to close.
   *
   * The table above could be arithmetically correct and still be pointed at the wrong target — a
   * pull of zero derives cleanly and grades nothing. This measures the *result*, and it says two
   * different things because the grade makes two different promises:
   *
   *   * an uncapped structure lands within a quarter-stop of the plate it stands on, where the
   *     ungraded set ran from two thirds of the plate's luminance to nearly double it;
   *   * a structure held at {@link MAX_BRIGHTEN} stays **darker** than the plate — the cap can only
   *     ever leave one dark — and is still closer than it was ungraded, so the cap is a limit on
   *     the correction rather than an escape from it.
   */
  it('leaves every structure a quarter-stop from the plate, or dark on purpose', () => {
    for (const [kind, art] of measured) {
      const { brightness } = STRUCTURE_GRADE[kind];
      const after = art.lum * brightness;
      const target = plate?.lum ?? 1;
      const where = `${kind}: ${art.lum.toFixed(1)} graded to ${after.toFixed(1)}, plate ${target.toFixed(1)}`;
      if (brightness < MAX_BRIGHTEN) {
        expect(Math.abs(Math.log2(after / target)), where).toBeLessThan(0.25);
      } else {
        expect(after, where).toBeLessThan(target);
        expect(target - after, where).toBeLessThan(target - art.lum);
      }
    }
  });
});
