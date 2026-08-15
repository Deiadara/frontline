import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findAssetSpec, tryResolveAssetKey, type BuildingKind } from '@frontline/shared';
import {
  DISTRICT_SITES_BY_DEPTH,
  siteBox,
  type DistrictSite,
} from '../apps/client/src/features/base/plots.js';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Can a player click the building they are looking at?
 *
 * A plot is a `<button>` the size of its art's bounding box, and those boxes **overlap by design**:
 * a tall structure's upper mass passes in front of the row behind it, which is what depth looks
 * like from above. The browser hit-tests rectangles, not alpha, so wherever a nearer plot's box
 * covers a farther plot's *painted pixels*, those pixels answer for the wrong building — the player
 * clicks a greenhouse and selects a tower.
 *
 * Nothing else can see this. The unit layout test has no images, so it cannot know which pixels are
 * painted; the e2e clicks each plot at its centre, which stays clear even when a quarter of the
 * building around it does not. The layout that this file was written against lost 26% of the
 * Greenhouse that way, with every other gate green.
 *
 * So it is measured here, where the masters can be opened: rasterise each structure exactly as the
 * browser will — `object-contain`, `object-bottom`, inside its site box — and count the painted
 * pixels a nearer box would swallow.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(REPO_ROOT, 'assets');

/** The scene at plate resolution. Percentages, so any size gives the same answer within rounding. */
const W = 1376;
const H = 768;

/** Alpha at or above which a pixel is artwork a player can see and would expect to click. */
const PAINTED = 32;

/**
 * The share of a structure's painted pixels that may answer for something else.
 *
 * Not zero, because the rasterisation here rounds where the browser's compositor does not, and a
 * bound of exactly zero would be a bound on floating-point luck. One percent is far below anything
 * a hand can notice and two orders of magnitude below the failure it replaces.
 */
const MAX_STOLEN = 0.01;

interface Placed {
  kind: BuildingKind;
  /** The button's rect, in scene pixels. */
  box: { left: number; top: number; right: number; bottom: number };
  /** Alpha of the structure as drawn, indexed by scene pixel. */
  alpha: Uint8Array;
  painted: number;
}

function rectOf(site: DistrictSite) {
  const box = siteBox(site);
  return {
    left: Math.round((box.x / 100) * W),
    top: Math.round((box.y / 100) * H),
    right: Math.round(((box.x + box.width) / 100) * W),
    bottom: Math.round(((box.y + box.height) / 100) * H),
  };
}

/** `object-contain` + `object-bottom` inside the box — the two rules `StructureSprite` applies. */
async function place(site: DistrictSite): Promise<Placed | null> {
  const key = tryResolveAssetKey({ type: 'building', building: site.kind });
  const spec = key === undefined ? undefined : findAssetSpec(key);
  if (!spec) return null;
  const file = path.join(ASSET_DIR, spec.file);
  if ((await readFile(file).catch(() => null)) === null) return null;

  const box = rectOf(site);
  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  const meta = await sharp(file).metadata();
  const scale = Math.min(boxWidth / meta.width, boxHeight / meta.height);
  const drawWidth = Math.max(1, Math.round(meta.width * scale));
  const drawHeight = Math.max(1, Math.round(meta.height * scale));
  const { data, info } = await sharp(file)
    .resize(drawWidth, drawHeight)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alpha = new Uint8Array(W * H);
  const originX = box.left + Math.round((boxWidth - drawWidth) / 2);
  const originY = box.top + (boxHeight - drawHeight);
  let painted = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const sceneX = originX + x;
      const sceneY = originY + y;
      if (sceneX < 0 || sceneY < 0 || sceneX >= W || sceneY >= H) continue;
      const a = data[(y * info.width + x) * info.channels + 3] ?? 0;
      alpha[sceneY * W + sceneX] = a;
      if (a >= PAINTED) painted += 1;
    }
  }
  return { kind: site.kind, box, alpha, painted };
}

describe('every painted pixel answers for its own building', () => {
  /** Back to front — the order the scene paints in, which is also the order it hit-tests in. */
  const placed: Placed[] = [];

  beforeAll(async () => {
    for (const site of DISTRICT_SITES_BY_DEPTH) {
      const one = await place(site);
      if (one !== null) placed.push(one);
    }
  }, 120_000);

  it('has structures to measure', () => {
    expect(placed.length, 'no structure master has been delivered').toBeGreaterThan(0);
    for (const one of placed)
      expect(one.painted, `${one.kind} draws nothing`).toBeGreaterThan(1000);
  });

  it('never lets a nearer plot swallow a farther one’s artwork', () => {
    const losses: string[] = [];
    for (const [index, back] of placed.entries()) {
      const nearer = placed.slice(index + 1).map((one) => one.box);
      let stolen = 0;
      for (let y = back.box.top; y < back.box.bottom; y += 1) {
        for (let x = back.box.left; x < back.box.right; x += 1) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if ((back.alpha[y * W + x] ?? 0) < PAINTED) continue;
          if (nearer.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) {
            stolen += 1;
          }
        }
      }
      const share = stolen / back.painted;
      if (share > MAX_STOLEN) {
        losses.push(`${back.kind} loses ${(share * 100).toFixed(1)}% (${stolen}/${back.painted})`);
      }
    }
    expect(losses, losses.join('; ')).toEqual([]);
  });
});
