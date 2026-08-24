/**
 * Cuts each structure's portrait out of the district painting itself.
 *
 *   pnpm --filter @frontline/scripts building-portraits
 *
 * The plot dialog used to show `building-<kind>.webp`: masters drawn for the *previous* plate,
 * back when structures were cutouts pasted onto empty ground. Against the delivered painting they
 * are simply pictures of different buildings: the window said "The Quarters" over an illustration
 * that looks nothing like the tenement stack the player just clicked. That is what "the sprites are
 * way off" means, and no amount of re-grading fixes it, because the drawing is wrong rather than
 * mistoned.
 *
 * So the portrait is taken from the one place that cannot disagree with the map: **the map**. Each
 * structure's traced outline (`apps/client/src/features/base/plots.ts`) is used as an alpha mask
 * over the plate, cropped to its own bounding box and written out with transparency. What the
 * window shows is then, by construction, the building the player is looking at.
 *
 * The masters are not deleted: a delivered `building-<kind>` still wins if one is present, so the
 * board can hand over a real illustration for any structure and it drops in over the crop.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { findAssetSpec, type BuildingKind } from '@frontline/shared';
import { DISTRICT_SITES, type DistrictSite } from '../apps/client/src/features/base/plots.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATE = path.join(REPO_ROOT, 'art-src', 'plate-district.png');
const OUT_DIR = path.join(REPO_ROOT, 'assets');

/**
 * How far past the outline the crop reaches, as a fraction of the shape's size.
 *
 * A tracing hugs the silhouette so the *hit area* is exactly the building. A portrait wants a
 * little of the street around it: a cutout sheared precisely along the roofline reads as damage
 * rather than as a picture of a building.
 */
const BLEED = 0.06;

/** The outline's bounding box in plate pixels, with a little of the street around it. */
export function portraitBox(
  site: DistrictSite,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const xs = site.shape.map(([x]) => (x / 100) * width);
  const ys = site.shape.map(([, y]) => (y / 100) * height);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = (maxX - minX) * BLEED;
  const padY = (maxY - minY) * BLEED;

  const left = Math.max(0, Math.floor(minX - padX));
  const top = Math.max(0, Math.floor(minY - padY));
  return {
    left,
    top,
    width: Math.min(width - left, Math.ceil(maxX - minX + padX * 2)),
    height: Math.min(height - top, Math.ceil(maxY - minY + padY * 2)),
  };
}

/**
 * The outline as an SVG mask, in the crop's own coordinates.
 *
 * Feathered with a blur so the cut edge is a soft one. A hard alpha edge on a painting this dense
 * reads as a sticker; three pixels of falloff reads as a vignette.
 */
function maskSvg(
  site: DistrictSite,
  box: { left: number; top: number; width: number; height: number },
  plate: { width: number; height: number },
): Buffer {
  const points = site.shape
    .map(([x, y]) => `${(x / 100) * plate.width - box.left},${(y / 100) * plate.height - box.top}`)
    .join(' ');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
      `<defs><filter id="soft"><feGaussianBlur stdDeviation="3" /></filter></defs>` +
      `<polygon points="${points}" fill="#fff" filter="url(#soft)" />` +
      `</svg>`,
  );
}

async function main(): Promise<number> {
  const plate = sharp(PLATE);
  const meta = await plate.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    process.stderr.write(`cannot read ${PLATE}\n`);
    return 1;
  }

  const spec = findAssetSpec('plate-district');
  if (spec && (spec.width !== width || spec.height !== height)) {
    process.stderr.write(
      `plate is ${width}x${height} but the manifest says ${spec.width}x${spec.height}: ` +
        'the outlines are positions on the manifest size, so this would cut the wrong pixels\n',
    );
    return 1;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const source = await plate.png().toBuffer();

  for (const site of DISTRICT_SITES) {
    const box = portraitBox(site, width, height);
    const cut = await sharp(source).extract(box).ensureAlpha().toBuffer();
    const mask = await sharp(maskSvg(site, box, { width, height }))
      .extractChannel('red')
      .toBuffer();

    const out = path.join(OUT_DIR, `${portraitKey(site.kind)}.webp`);
    const bytes = await sharp(cut)
      .joinChannel(mask)
      .webp({ quality: 90, alphaQuality: 90 })
      .toBuffer();
    await writeFile(out, bytes);
    process.stdout.write(`${path.relative(REPO_ROOT, out)} ${box.width}x${box.height}\n`);
  }
  return 0;
}

/** The asset filename a structure's plate portrait is written to. */
export function portraitKey(kind: BuildingKind): string {
  return `portrait-${kind}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
