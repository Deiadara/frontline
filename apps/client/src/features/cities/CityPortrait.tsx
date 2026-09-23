import { useMemo } from 'react';
import { cityPortraitUrl } from '../../assets/delivered';
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
 * ## The maintainer's own painting
 *
 * The drop seam is live: `city-<id>.webp` in `assets/` replaces the skyline for that city and
 * nothing else changes. `cityPortraitUrl` is the lookup, and the five names it wants are
 * `city-ashfall`, `city-saltmarch`, `city-verge-station`, `city-redline` and `city-deepcut`.
 * A painting is drawn `object-cover`, because the card it sits in is a column of the world screen
 * and its height comes off the window rather than off the picture.
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

export function CityPortrait({ cityId }: { cityId: string }) {
  const painted = cityPortraitUrl(cityId);

  /*
   * 390 by 640 is a hair under 1:1.64, which is the middle of the range the card actually takes.
   *
   * The card used to be a fixed 3:4 box and the viewBox matched it exactly, so `meet` and `slice`
   * were the same thing and nothing was ever cut. The card is a full-height column now and its
   * aspect runs from about 1:1.3 at three columns to 1:2.1 on a tall wide window, so no single
   * viewBox can match it. `slice` is the right half of that trade: it fills the card and crops the
   * overhang, the way the painting that replaces it will. `meet` would letterbox instead, and
   * transparent bands top and bottom of a skyline read as a broken image rather than as a choice.
   */
  const width = 390;
  const height = 640;

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

  if (painted !== null) {
    return (
      <img
        src={painted}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
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

      <g>
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
