/**
 * Draws `docs/art/district-template.png` — the placement guide for `plate-district`.
 *
 *   pnpm --filter @frontline/scripts district-template
 *
 * The district plate is the one asset whose composition is constrained by code: thirteen
 * structures are dropped onto it at fixed points, so ground painted where the site table has no
 * site is decoration nobody stands on, and a road painted through a site is a building standing in
 * the street.
 *
 * It composites the **delivered masters themselves**, at exactly the size and position the client
 * renders them, over a neutral ground. A guide made of empty rectangles answers "where may I
 * paint?" and not "what will this look like?" — and rectangles are the misleading half of the
 * question anyway, because a box is the room a structure *may* take and the art inside it is
 * usually smaller. A key with no master yet falls back to its outline, which is the honest picture
 * of a pad nobody has drawn a building for.
 *
 * The layout it reads is the client's, not a copy: `apps/client/src/features/base/plots.ts` is the
 * only place it is written down, and a guide drawn from a second copy would be a guide to a
 * district that does not exist.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { findAssetSpec, tryResolveAssetKey, type BuildingKind } from '@frontline/shared';
import {
  DISTRICT_BACK_EDGE,
  DISTRICT_SITES_BY_DEPTH,
  siteBox,
  type DistrictSite,
} from '../apps/client/src/features/base/plots.js';
import { STRUCTURE_GRADE } from '../apps/client/src/features/base/masters.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(REPO_ROOT, 'assets');
const OUT = path.join(REPO_ROOT, 'docs', 'art', 'district-template.png');

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A site resolved to pixels on the plate. */
export interface Pad {
  site: DistrictSite;
  /** The room the structure may take. */
  box: Rect;
  /** Where its feet land. */
  ground: { x: number; y: number };
}

export function padsFor(width: number, height: number): Pad[] {
  return DISTRICT_SITES_BY_DEPTH.map((site) => {
    const box = siteBox(site);
    return {
      site,
      box: {
        left: Math.round((box.x / 100) * width),
        top: Math.round((box.y / 100) * height),
        width: Math.round((box.width / 100) * width),
        height: Math.round((box.height / 100) * height),
      },
      ground: {
        x: Math.round((site.x / 100) * width),
        y: Math.round((site.baseline / 100) * height),
      },
    };
  });
}

/**
 * The rect a master actually paints in — `object-contain` inside the pad, `object-bottom` anchoring
 * it to the ground line. The same two rules `StructureSprite` applies in the browser.
 */
export function containedRect(pad: Pad, master: { width: number; height: number }): Rect {
  const scale = Math.min(pad.box.width / master.width, pad.box.height / master.height);
  const width = Math.round(master.width * scale);
  const height = Math.round(master.height * scale);
  return {
    left: pad.box.left + Math.round((pad.box.width - width) / 2),
    top: pad.box.top + (pad.box.height - height),
    width,
    height,
  };
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The neutral ground the structures are composited onto. */
export function groundSvg(width: number, height: number, pads: readonly Pad[]): string {
  const backEdge = Math.round((DISTRICT_BACK_EDGE / 100) * height);
  const shadows = pads
    .map(
      (pad) => `<ellipse cx="${pad.ground.x}" cy="${pad.ground.y}"
        rx="${Math.round(pad.box.width * 0.42)}" ry="${Math.round(pad.box.height * 0.05)}"
        fill="#000000" fill-opacity="0.25"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#46523c"/>
    <rect width="${width}" height="${backEdge}" fill="#2b3327"/>
    ${shadows}
  </svg>`;
}

/**
 * The pool of shade each structure sits in, drawn under all of them.
 *
 * The same ellipse `DistrictScene` renders, and it is what seats a cutout on ground seen from
 * above: a drop shadow is a silhouette cast on a *wall*, which is the wrong shadow for a town view.
 * Drawn in one pass beneath every structure so a shadow can never fall across the building in
 * front of it.
 */
export function contactShadowSvg(width: number, height: number, pads: readonly Pad[]): string {
  // `w-[86%] h-[14%]` of the box, bottom-anchored and nudged down a third of its own height —
  // `ContactShadow`'s Tailwind, arithmetic'd out. A hard ellipse here would make the guide show a
  // disc the browser never draws, and the guide would then be lying about the one thing it exists
  // to check.
  const pools = pads
    .map((pad, index) => {
      const rx = (pad.box.width * 0.86) / 2;
      const ry = (pad.box.height * 0.14) / 2;
      const cy = pad.ground.y - ry + (pad.box.height * 0.14) / 3;
      return `<radialGradient id="pool-${index}">
          <stop offset="0%" stop-color="#05070d" stop-opacity="0.8"/>
          <stop offset="100%" stop-color="#05070d" stop-opacity="0"/>
        </radialGradient>
        <ellipse cx="${pad.ground.x}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}"
          ry="${ry.toFixed(1)}" fill="url(#pool-${index})"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${pools}</svg>`;
}

/** The pad outlines and labels, drawn over the structures so nothing hides them. */
export function annotationSvg(
  width: number,
  height: number,
  pads: readonly Pad[],
  painted: ReadonlySet<string>,
): string {
  const marks = pads
    .map((pad) => {
      const drawn = painted.has(pad.site.kind);
      const stroke = drawn ? '#22d3ee' : '#e11d8f';
      const label = drawn ? pad.site.kind : `${pad.site.kind} — no master yet`;
      return `
      <rect x="${pad.box.left}" y="${pad.box.top}" width="${pad.box.width}"
            height="${pad.box.height}" fill="none" stroke="${stroke}" stroke-width="2"
            stroke-dasharray="10 8" stroke-opacity="0.75"/>
      <text x="${pad.ground.x}" y="${pad.ground.y + 30}" fill="${stroke}" font-size="24"
            font-family="monospace" text-anchor="middle"
            paint-order="stroke" stroke="#05070d" stroke-width="5"
            >${escape(label)}</text>`;
    })
    .join('');
  // Both captions ride in one bar at the top. The front row's labels sit within 30px of the
  // bottom edge, so a footer caption lands on top of them.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    ${marks}
    <rect x="0" y="0" width="${width}" height="86" fill="#05070d" fill-opacity="0.72"/>
    <text x="20" y="34" fill="#dfe6d4" font-size="24" font-family="monospace"
      >${width}x${height} — no sky: the whole frame is ground, seen from above.</text>
    <text x="20" y="68" fill="#dfe6d4" font-size="24" font-family="monospace"
      >Paint under these. Every dashed pad stays flat and clear; the lanes between them are the roads.</text>
  </svg>`;
}

/**
 * The client's `filter: brightness() saturate()` grade, applied with libvips.
 *
 * The guide is only worth looking at if it shows what the browser will show, and the grade is most
 * of what makes a cutout sit in the painting rather than on it. `brightness` is a plain per-channel
 * multiply in both; `saturate` is the same luma-preserving matrix CSS specifies, written out here
 * because libvips has no named equivalent.
 */
function graded(image: Sharp, kind: BuildingKind): Sharp {
  const { brightness, saturate: k } = STRUCTURE_GRADE[kind];
  // The luma coefficients CSS `saturate()` is specified against (filter-effects-1 §8.6).
  const lr = 0.213;
  const lg = 0.715;
  const lb = 0.072;
  const row = (r: number, g: number, b: number): [number, number, number] => [
    r * brightness,
    g * brightness,
    b * brightness,
  ];
  return image.recomb([
    row(lr + k * (1 - lr), lg * (1 - k), lb * (1 - k)),
    row(lr * (1 - k), lg + k * (1 - lg), lb * (1 - k)),
    row(lr * (1 - k), lg * (1 - k), lb + k * (1 - lb)),
  ]);
}

async function deliveredMaster(
  kind: BuildingKind,
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const key = tryResolveAssetKey({ type: 'building', building: kind });
  const spec = key === undefined ? undefined : findAssetSpec(key);
  if (!spec) return null;
  const buffer = await readFile(path.join(ASSET_DIR, spec.file)).catch(() => null);
  if (!buffer) return null;
  const { width, height } = await sharp(buffer).metadata();
  return width !== undefined && height !== undefined ? { buffer, width, height } : null;
}

export async function main(): Promise<number> {
  const spec = findAssetSpec('plate-district');
  if (!spec) {
    process.stderr.write('plate-district is missing from the manifest\n');
    return 1;
  }
  // The plate's own size, not its class's: `plate-district` is the one asset delivered off the §6
  // table, and drawing the guide at 2048×1152 would place every pad on a plate that does not exist.
  const { width, height } = spec;
  const pads = padsFor(width, height);
  const plate = await readFile(path.join(ASSET_DIR, spec.file)).catch(() => null);

  // Composited in pad order, which is back-to-front — the same order the district paints in.
  const structures: OverlayOptions[] = [];
  const painted = new Set<string>();
  for (const pad of pads) {
    const master = await deliveredMaster(pad.site.kind);
    if (!master) continue;
    painted.add(pad.site.kind);
    const rect = containedRect(pad, master);
    structures.push({
      input: await graded(sharp(master.buffer).resize(rect.width, rect.height), pad.site.kind)
        .png()
        .toBuffer(),
      left: rect.left,
      top: rect.top,
    });
  }

  // Composited onto the delivered plate once there is one. The neutral ground was the honest
  // picture while the painting was still a brief; now that it exists, the only question worth
  // asking is whether each structure lands on its lot, and a stand-in ground cannot answer it.
  const base = plate === null ? Buffer.from(groundSvg(width, height, pads)) : plate;
  // `--clean` drops the pad outlines and labels. They answer "is this site on that lot?"; without
  // them the same image answers "does this look like one place?", and no annotated picture can.
  const clean = process.argv.includes('--clean');
  const png = await sharp(base)
    .composite([
      { input: Buffer.from(contactShadowSvg(width, height, pads)), left: 0, top: 0 },
      ...structures,
      ...(clean
        ? []
        : [{ input: Buffer.from(annotationSvg(width, height, pads, painted)), left: 0, top: 0 }]),
    ])
    .png()
    .toBuffer();

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, png);
  process.stdout.write(
    `${path.relative(REPO_ROOT, OUT)}: ${width}x${height} on ` +
      `${plate === null ? 'the stand-in ground' : spec.file}, ` +
      `${painted.size}/${pads.length} structures composited\n`,
  );
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main();
}
