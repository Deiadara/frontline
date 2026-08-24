/**
 * Paints the `{ kind: 'procedural' }` half of the asset seam: ADR 0001 §5.3.
 *
 * `assets/source.ts` resolves every manifest key to either a delivered file or a procedural
 * fallback; this module is what draws the fallback. Nothing here is reached once real art lands in
 * `assets/`, which is exactly the point: dropping `plane-city-far.webp` in flips the plane to the
 * painting with no code change.
 *
 * Geometry comes pre-computed and seeded from `skyline.ts` so it is unit-tested; this file only
 * turns it into display objects. `FillGradient` bakes through a 2D canvas, so, like `grade.ts`:
 * construction needs a real browser and is verified in Chromium, not jsdom.
 */
import { findAssetSpec, type AssetKey } from '@frontline/shared';
import { Container, FillGradient, Graphics } from 'pixi.js';
import { ramps, hex } from '../theme/tokens';
import { generateCityPlan, LAMP_FILLS, type CityPlan } from './cityplan';
import { type DepthBand } from './skyline';
import type { AssetSource } from '../assets/source';

/** Which band each procedural map key paints as. */
const BAND_BY_KEY: Record<string, DepthBand> = {
  'plane-city-sky': 'sky',
  'plane-city-far': 'far',
  'plane-city-fore': 'fore',
  'plate-city': 'mid',
};

/**
 * Wet ground, seen from above.
 *
 * The old backdrop was a night sky with a horizon glow in it, which is exactly what a plan view has
 * none of. This is the floor instead: near-black asphalt with a slow warm pool through the middle,
 * which is the city's own sodium light bouncing back off standing water. It is the one thing on the
 * map that is genuinely flat, so it gets the only gradient.
 */
function groundPlane(width: number, height: number, fill: string): Graphics {
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: ramps.abyss[500] },
      { offset: 0.4, color: fill },
      { offset: 0.7, color: ramps.smog[500] },
      { offset: 1, color: ramps.abyss[300] },
    ],
  });
  const g = new Graphics();
  g.label = 'ground';
  g.rect(0, 0, width, height).fill(gradient);
  return g;
}

/**
 * Air over the ground, per band.
 *
 * A plan view has no horizon to fade into, so this is not aerial perspective. It is the smog that
 * sits *in* the streets. It pools toward the bottom of each band, which is the direction the camera
 * is looking away down, and it is what keeps a far block from reading as sharply as a near one.
 *
 * `null` for the near bands: fogging the layer the player is reading would only mute it.
 */
const BAND_FOG: Partial<Record<DepthBand, { color: string; alpha: number }>> = {
  sky: { color: ramps.smog[950], alpha: 0.4 },
  far: { color: ramps.smog[950], alpha: 0.28 },
};

function bandFog(band: DepthBand, width: number, height: number): Graphics | null {
  const fog = BAND_FOG[band];
  if (!fog) return null;
  const to = (alpha: number) =>
    `${fog.color}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0')}`;
  const gradient = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: 'local',
    colorStops: [
      { offset: 0, color: to(fog.alpha * 0.5) },
      { offset: 0.5, color: to(fog.alpha * 0.2) },
      { offset: 1, color: to(fog.alpha) },
    ],
  });
  const g = new Graphics();
  g.label = `fog-${band}`;
  g.rect(0, 0, width, height).fill(gradient);
  return g;
}

/**
 * One band of the plan: ground, water, lanes, blocks, roofs, lamps: in that order, because that is
 * the order they sit in on the ground.
 *
 * Lamps are drawn into their own additive layer rather than per roof. Two reasons: the bloom pass
 * (`grade.ts`) thresholds on brightness and wants the emissives isolated, and batching every lamp
 * into one `Graphics` keeps a plane with three hundred roofs to a handful of draw calls.
 */
export function paintCityPlan(plan: CityPlan): Container {
  const root = new Container();
  root.label = `plan-${plan.band}`;

  if (plan.ground !== null) root.addChild(groundPlane(plan.width, plan.height, plan.ground));

  if (plan.canal) {
    const water = new Graphics();
    water.label = 'canal';
    water.poly(plan.canal.outline).fill(hex(plan.canal.fill));
    root.addChild(water);
  }

  if (plan.lanes.length > 0) {
    const lanes = new Graphics();
    lanes.label = 'lanes';
    for (const lane of plan.lanes) {
      const [first, ...rest] = lane.points;
      if (!first) continue;
      lanes.moveTo(first.x, first.y);
      for (const point of rest) lanes.lineTo(point.x, point.y);
      lanes.stroke({ width: lane.width, color: hex(lane.fill), alpha: 0.75, cap: 'round' });
    }
    root.addChild(lanes);
  }

  const ground = new Graphics();
  ground.label = 'blocks';
  const roofs = new Graphics();
  roofs.label = 'roofs';
  const warm = new Graphics();
  const cold = new Graphics();
  warm.label = 'lamps-warm';
  cold.label = 'lamps-cold';

  for (const block of plan.blocks) {
    ground.poly(block.outline).fill(hex(block.fill));
    for (const roof of block.roofs) {
      roofs.poly(roof.outline).fill(hex(roof.fill));
      if (roof.lamp) {
        (roof.lamp.warm ? warm : cold).circle(roof.lamp.x, roof.lamp.y, roof.lamp.r);
      }
    }
  }
  warm.fill({ color: hex(LAMP_FILLS.warm), alpha: 0.9 });
  cold.fill({ color: hex(LAMP_FILLS.cold), alpha: 0.75 });
  warm.blendMode = 'add';
  cold.blendMode = 'add';

  root.addChild(ground, roofs, warm, cold);
  return root;
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
  root.addChild(paintCityPlan(generateCityPlan(band, width, height, seed)));
  const fog = bandFog(band, width, height);
  if (fog) root.addChild(fog);
  return root;
}

function paintBand(key: AssetKey, width: number, height: number, seed: number): Container | null {
  const band = BAND_BY_KEY[key];
  return band ? paintProceduralPlane(band, width, height, seed) : null;
}

/**
 * The seam itself: hand it whatever `ArtLoader.sourceOf` returned. A delivered file is *not* this
 * module's job, the caller uses the texture, so a `file` source yields `null`.
 */
export function paintProcedural(
  source: AssetSource | undefined,
  width: number,
  height: number,
): Container | null {
  return source?.kind === 'procedural' ? paintBand(source.key, width, height, source.seed) : null;
}

/**
 * The interim painting for a map key, whatever that key resolves to today.
 *
 * {@link paintProcedural} is the seam and rightly declines a delivered file. This is what the
 * caller draws in the gap *before* that file's texture is in hand, and if the fetch fails so it
 * never arrives at all, so a plane whose master has landed is never a hole in the background.
 */
export function paintPlaneFallback(key: AssetKey, width: number, height: number): Container | null {
  const spec = findAssetSpec(key);
  return spec ? paintBand(key, width, height, spec.seed) : null;
}
