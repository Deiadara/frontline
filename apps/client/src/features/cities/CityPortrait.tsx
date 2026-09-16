import { useMemo } from 'react';
import { generateSkyline, type DepthBand } from '../../render/skyline';

/**
 * A city, drawn, until the maintainer's painting lands on top of it.
 *
 * Three bands of the procedural skyline (`render/skyline.ts`), seeded off the city id, so every
 * city has its own permanent silhouette and the same one every time it is drawn. That module was
 * written for the city backdrop and had no caller left; a card that needs a picture of a place is
 * exactly what it is for.
 *
 * ## Why generated rather than a grey box
 *
 * The art policy is that everything ships on code-generated art until real masters arrive, and a
 * placeholder rectangle with a city name on it tells a player nothing about whether Saltmarch and
 * Verge Station are different places. Three bands of towers at different depths do: one is low and
 * broken and the other is tall and regular, because the seeds differ, and that reads as two cities
 * before a single word is read.
 *
 * The import path stays open. When `plate-city-<id>` masters exist, this component takes a
 * `src` and paints it over the skyline with no other change to the card.
 */

/** Back to front, and the order they are painted in. */
const BANDS: readonly DepthBand[] = ['far', 'mid', 'fore'];

/** Stable, small, and different per city: the same id always draws the same skyline. */
function seedOf(cityId: string): number {
  let hash = 2166136261;
  for (let at = 0; at < cityId.length; at += 1) {
    hash ^= cityId.charCodeAt(at);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 100000;
}

export function CityPortrait({ cityId, dim = false }: { cityId: string; dim?: boolean }) {
  /*
   * 390 by 520 is exactly 3:4, which is the aspect of the box this sits in.
   *
   * It was 400 by 520 (0.769 against the card's 0.75), and with `slice` that cropped eleven pixels
   * off the bottom of every portrait. Small enough to miss by eye and caught by the image gate,
   * which is what that gate is for. Matching the ratio means `meet` and `slice` are the same thing
   * here and nothing is cut: the drawing fills the card exactly.
   */
  const width = 390;
  const height = 520;

  const bands = useMemo(
    () =>
      BANDS.map((band, index) => ({
        band,
        // Each band gets its own stream off the same city seed, so moving one does not reshuffle
        // the others, and the three stay in the same relationship on every render.
        skyline: generateSkyline(band, width, height, seedOf(cityId) + index * 977),
      })),
    [cityId],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      className="absolute inset-0 h-full w-full"
    >
      {/* The sky: a cold wash with the sodium haze the city sits under. */}
      <defs>
        <linearGradient id={`sky-${cityId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1b1a22" />
          <stop offset="62%" stopColor="#24222e" />
          <stop offset="100%" stopColor="#2c2733" />
        </linearGradient>
        <radialGradient id={`glow-${cityId}`} cx="50%" cy="88%" r="62%">
          <stop offset="0%" stopColor="#f0ad4c" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#f0ad4c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill={`url(#sky-${cityId})`} />
      <rect width={width} height={height} fill={`url(#glow-${cityId})`} />

      <g opacity={dim ? 0.55 : 1}>
        {bands.map(({ band, skyline }) => (
          <g key={band}>
            {skyline.towers.map((tower, at) => (
              <g key={`${band}-${at}`}>
                <path
                  d={`M ${tower.outline.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`}
                  fill={tower.fill}
                />
                {/* Lit windows, which is the whole difference between a silhouette and a city
                    somebody lives in. A derelict mass carries none, by the generator's own rule,
                    so there is nothing to draw on the gutted ones. Warm is sodium interior, cold
                    is display glow (ART-BIBLE 3.3). */}
                {tower.windows.map((cell, index) => (
                  <rect
                    key={index}
                    x={cell.x}
                    y={cell.y}
                    width={cell.w}
                    height={cell.h}
                    fill={cell.warm ? '#f0ad4c' : '#a99ef0'}
                    opacity={0.82}
                  />
                ))}
              </g>
            ))}
            {/* Gantries and slung walkways, painted as closed quads over the masses they tie. */}
            {skyline.struts.map((strut, at) => (
              <path
                key={`strut-${band}-${at}`}
                d={`M ${strut.outline.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`}
                fill={strut.fill}
              />
            ))}
          </g>
        ))}
      </g>

      {/* The ground the towers stand on, so the card has a floor rather than fading out. */}
      <rect y={height - 26} width={width} height={26} fill="#100f16" />
    </svg>
  );
}
