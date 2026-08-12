/**
 * Paints the `{ kind: 'procedural' }` half of the asset seam — ADR 0001 §5.3.
 *
 * `assets/source.ts` resolves every manifest key to either a delivered file or a procedural
 * fallback; this module is what draws the fallback. Nothing here is reached once real art lands in
 * `assets/`, which is exactly the point: dropping `plane-city-far.webp` in flips the plane to the
 * painting with no code change.
 *
 * Geometry comes pre-computed and seeded from `skyline.ts` so it is unit-tested; this file only
 * turns it into display objects. `FillGradient` bakes through a 2D canvas, so — like `grade.ts` —
 * construction needs a real browser and is verified in Chromium, not jsdom.
 */
import { Container, FillGradient, Graphics } from 'pixi.js';
import { ramps, hex } from '../theme/tokens';
import { generateSkyline, WINDOW_FILLS, type DepthBand, type Skyline } from './skyline';
import type { AssetSource } from '../assets/source';

/** Which band each procedural map key paints as. The mid plate is a dense `far` mass. */
const BAND_BY_KEY: Record<string, DepthBand> = {
  'plane-city-sky': 'sky',
  'plane-city-far': 'far',
  'plane-city-fore': 'fore',
  'plate-city': 'far',
};

/**
 * Night-sky backdrop: `abyss.950` overhead falling to a bruised `sear.950` horizon glow — the city
 * lighting its own smog from below (ART-BIBLE §3.3). Only the `sky` plane is opaque; every plane in
 * front of it composites over this.
 */
function skyBackdrop(width: number, height: number): Graphics {
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: ramps.abyss[950] },
      { offset: 0.55, color: ramps.abyss[700] },
      { offset: 0.86, color: ramps.smog[950] },
      { offset: 1, color: ramps.sear[950] },
    ],
  });
  const g = new Graphics();
  g.label = 'sky-backdrop';
  g.rect(0, 0, width, height).fill(gradient);
  return g;
}

/**
 * Sodium haze pooling along the skyline base. Additive so it reads as light in the air rather than
 * as a grey wash over the architecture.
 */
function groundHaze(width: number, height: number): Graphics {
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: `${ramps.ember[700]}00` },
      { offset: 1, color: `${ramps.ember[700]}5c` },
    ],
  });
  const g = new Graphics();
  g.label = 'ground-haze';
  g.blendMode = 'add';
  g.rect(0, height * 0.62, width, height * 0.38).fill(gradient);
  return g;
}

/** One filled polygon per tower, then one batched pass per window tint. */
function paintTowers(skyline: Skyline): Container {
  const masses = new Graphics();
  masses.label = 'masses';
  const warm = new Graphics();
  const cold = new Graphics();
  warm.label = 'windows-warm';
  cold.label = 'windows-cold';

  for (const tower of skyline.towers) {
    masses.poly(tower.outline).fill(hex(tower.fill));
    for (const cell of tower.windows) {
      (cell.warm ? warm : cold).rect(cell.x, cell.y, cell.w, cell.h);
    }
  }
  warm.fill({ color: hex(WINDOW_FILLS.warm), alpha: 0.85 });
  cold.fill({ color: hex(WINDOW_FILLS.cold), alpha: 0.7 });

  // Emissives are additive so the bloom threshold (grade.ts) catches them and nothing else.
  warm.blendMode = 'add';
  cold.blendMode = 'add';

  const layer = new Container();
  layer.label = `skyline-${skyline.band}`;
  layer.addChild(masses, warm, cold);
  return layer;
}

/**
 * Paints one procedural plane at `width x height`. The returned container is positioned by the
 * caller onto its parallax plane; it draws from `(0, 0)` with the horizon at the bottom edge.
 */
export function paintProceduralPlane(
  band: DepthBand,
  width: number,
  height: number,
  seed: number,
): Container {
  const root = new Container();
  root.label = `procedural-${band}`;
  if (band === 'sky') root.addChild(skyBackdrop(width, height));
  root.addChild(paintTowers(generateSkyline(band, width, height, seed)));
  if (band !== 'fore') root.addChild(groundHaze(width, height));
  return root;
}

/**
 * The seam itself: hand it whatever `ArtLoader.sourceOf` returned. A delivered file is *not* this
 * module's job — the caller uses the texture — so a `file` source yields `null`.
 */
export function paintProcedural(
  source: AssetSource | undefined,
  width: number,
  height: number,
): Container | null {
  if (source?.kind !== 'procedural') return null;
  const band = BAND_BY_KEY[source.key];
  return band ? paintProceduralPlane(band, width, height, source.seed) : null;
}
