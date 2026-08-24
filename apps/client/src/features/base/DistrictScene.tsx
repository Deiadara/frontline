import {
  BUILDING_CATALOG,
  buildingLevel,
  isBuildingUnlocked,
  type Building,
  type BuildingKind,
  type BuildQueue,
} from '@frontline/shared';
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';
import { useMeasuredSize, type MeasuredSize } from '../../lib/useMeasuredHeight';
import { chrome, ramps } from '../../theme/tokens';
import {
  DISTRICT_ASPECT,
  DISTRICT_BACK_EDGE,
  DISTRICT_BAND,
  DISTRICT_PLATE,
  DISTRICT_SITES_BY_DEPTH,
  siteBounds,
  siteCentroid,
  siteDepth,
  sitePoints,
} from './plots';

/**
 * The district as a place (GDD §A1): one painted street, with twelve buildings in it that answer to
 * the pointer.
 *
 * The Grepolis move, and the thing that changed with the delivered plate: the structures are **not**
 * cutouts pasted onto ground any more. `plate-district` is a finished painting of the whole
 * district, buildings included, so there is nothing to paste — what the scene adds is an
 * *interaction layer* traced onto it. Each building has a polygon around its own silhouette
 * (`plots.ts`), and that polygon is the control:
 *
 *   * pointing at it **lights the building itself** — a warm wash blended over the painted pixels,
 *     inside the outline, so what brightens is the roof and the walls rather than a rectangle
 *     around them;
 *   * clicking it opens that structure's dialog;
 *   * a structure that has not been built yet is **shuttered** rather than absent: the painting
 *     draws it either way, so an unbuilt plot is a dark scrim over its outline with a dashed edge,
 *     which reads as a place waiting for work.
 *
 * The outline is what the browser hit-tests, not a box around it, so the Cistern beside the
 * Scrapyard and the Gate over the road each answer for exactly their own pixels — a class of bug
 * (click a greenhouse, select a tower) that the old rectangular plots needed a rasterising test to
 * keep out and that the shape rules out by construction.
 *
 * A plot is in one of four states, and each has to be legible at a glance: standing, being worked
 * on, empty and buildable, or empty and locked behind the Nexus. Names are shown on hover and focus
 * for a structure that is simply standing — a permanent plate on each of twelve buildings would
 * bury the painting — but `working`, `vacant` and `locked` keep theirs, because those three are what
 * a player scans the district *for*.
 */

interface DistrictSceneProps {
  buildings: readonly Building[];
  queue: BuildQueue;
  selected: BuildingKind | null;
  onSelect: (kind: BuildingKind) => void;
  /**
   * Somebody else's ground: draw it, do not offer to build on it.
   *
   * The scene is reused to show a neighbour's district on the city screen. Everything is the same
   * except that a plot stops being a control — there is nothing on another crew's land for you to
   * order — so outlines become plain marks and the unbuilt ones are not drawn at all: a scrim on
   * somebody else's lot reads as an invitation.
   */
  readOnly?: boolean;
}

/** The four states a plot can be in, in the order the label prefers to report them. */
type PlotState = 'working' | 'standing' | 'vacant' | 'locked';

const PLATE_STYLES: Record<PlotState, string> = {
  working: 'border-ember-300/70 bg-surface-950/90 text-ember-300',
  standing: 'border-surface-600 bg-surface-950/90 text-ink-200',
  vacant: 'border-dashed border-surface-600 bg-surface-950/90 text-ink-300',
  locked: 'border-dashed border-surface-600 bg-surface-950 text-ink-300',
};

/**
 * The states that keep a name plate even when the player is not pointing at them — which is every
 * state except a structure that is simply standing.
 *
 * A standing building is its own label: the painting shows what it is. What the painting cannot say
 * is that this one is being worked on, or that it is not really there yet, and those are the three
 * a player is looking for. Hiding them behind a hover made the one plot worth clicking — vacant and
 * unlocked — the only plot with nothing written on it.
 */
const ALWAYS_PLATED: readonly PlotState[] = ['working', 'vacant', 'locked'];

/**
 * How the outline is painted in each state.
 *
 * `fill` is composited over the painting, so the two shuttered states darken and the two live ones
 * are either clear or washed with light. The wash uses `screen`, which can only ever *add* — a
 * `normal`-blended warm fill would grey the building down as it lit it, which is the opposite of
 * what a highlight is for.
 */
interface Paint {
  fill: string;
  blend?: 'screen';
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}

const CLEAR: Paint = { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0 };

const SCRIM: Record<'vacant' | 'locked', Paint> = {
  vacant: {
    fill: 'rgba(6,9,14,0.58)',
    stroke: 'rgba(148,163,184,0.55)',
    strokeWidth: 2.5,
    dashed: true,
  },
  locked: {
    fill: 'rgba(4,6,10,0.76)',
    stroke: 'rgba(100,116,139,0.5)',
    strokeWidth: 2.5,
    dashed: true,
  },
};

const WORKING: Paint = {
  fill: 'rgba(255,164,72,0.13)',
  blend: 'screen',
  stroke: 'rgba(255,176,88,0.85)',
  strokeWidth: 3,
};

/** Pointed at, focused or selected — the building lights up. */
const LIT: Paint = {
  fill: 'rgba(255,214,150,0.20)',
  blend: 'screen',
  stroke: 'rgba(255,226,176,0.95)',
  strokeWidth: 3,
};

/** A shuttered plot under the pointer: the scrim lifts, so it reads as reachable rather than dead. */
const LIT_SCRIM: Record<'vacant' | 'locked', Paint> = {
  vacant: { ...SCRIM.vacant, fill: 'rgba(6,9,14,0.30)', stroke: 'rgba(255,226,176,0.95)' },
  locked: { ...SCRIM.locked, fill: 'rgba(4,6,10,0.52)', stroke: 'rgba(255,226,176,0.85)' },
};

/**
 * The district's box: as wide as the frame will take, with the **buildings** in the clear.
 *
 * Two rules pull against each other here and both are real.
 *
 * The board asked for a district that covers the screen it is in, and it is right to: an earlier
 * version fitted the whole painting into the room the chrome left over and drew a 940px picture
 * adrift in a field of empty background at 1440×900, with the game's best artwork shrunk into the
 * middle of it. But the floating HUD and the scenery switcher are opaque bars, and a building under
 * one of them is a building the pointer cannot reach — the version that simply filled the width put
 * the Quarters and the Lab behind the stockpile, where they were visible and dead.
 *
 * What dissolves it is that the plate's top and bottom edges are *empty ground*. The structures live
 * in a band ({@link DISTRICT_BAND}) that is about nine tenths of the picture, so the thing to fit
 * between the bars is that band, not the plate. Then the margins are what slides under the chrome —
 * roofline and street, which is exactly what a floating bar should be covering — and the painting
 * grows until either the buildings fill the gap or the picture fills the frame, whichever comes
 * first. On a desk-sized viewport that is edge to edge; on a short one the picture stops short at
 * the sides rather than hiding a door.
 *
 * `band` is the height between the bars, measured from a probe laid on the CSS variables the shell
 * publishes; zero (the city screen's preview, and jsdom, which has no layout) means no chrome, and
 * the plate simply fills the room.
 */
export function fitted(room: MeasuredSize, band: MeasuredSize, bleed = true): CSSProperties {
  if (room.width <= 0 || room.height <= 0) {
    return { width: '100%', aspectRatio: DISTRICT_ASPECT };
  }
  const clear = band.height > 0 ? band.height : room.height;
  // Not bleeding — the city screen's preview — is the plain reading: the whole picture, inside the
  // box, uncropped. Only the district screen has bars over the world to hide margins under.
  const share = bleed ? (DISTRICT_BAND.bottom - DISTRICT_BAND.top) / 100 : 1;
  const height = Math.min(clear / share, room.width / DISTRICT_ASPECT);
  return {
    width: Math.round(height * DISTRICT_ASPECT),
    height: Math.round(height),
    // Hang the picture off the top of the clear band by its own empty margin, so the first
    // building's roofline lands just under the HUD however tall the HUD has become.
    marginTop: bleed ? Math.round(-(DISTRICT_BAND.top / 100) * height) : 0,
  };
}

/**
 * A padlock, hung on a structure the Nexus has not authorised yet.
 *
 * Drawn rather than a glyph, and for a reason a 🔒 in the name plate cannot meet: the plate is a
 * line of 10px type at the bottom of a shape, and on a dark painting at this scale nobody reads it.
 * A lock has to be **the thing you see when you look at the building** — so it sits at the middle
 * of the outline, sized to the shape it belongs to, in the same sodium brass as every other thing
 * the interface asks you to want.
 *
 * In SVG user units on the plate, so it scales with the picture on every viewport and cannot drift
 * from the outline it is hung on.
 */
function Padlock({ x, y, size }: { x: number; y: number; size: number }) {
  const w = size;
  const body = w * 0.78;
  const shackle = w * 0.42;
  return (
    <g
      transform={`translate(${x - w / 2} ${y - w / 2})`}
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    >
      {/* A pool of shade under it, so the lock reads on a lit roof as well as on a dark one. */}
      <ellipse cx={w / 2} cy={w * 0.92} rx={w * 0.46} ry={w * 0.12} fill="rgba(4,6,10,0.55)" />
      {/* The shackle: drawn open at the bottom, which is what makes the silhouette read as a lock
          rather than as a keyhole or a bag. */}
      <path
        d={`M ${(w - shackle) / 2} ${w * 0.4}
            v ${-w * 0.1}
            a ${shackle / 2} ${shackle / 2} 0 0 1 ${shackle} 0
            v ${w * 0.1}`}
        fill="none"
        stroke={chrome.brass[300]}
        strokeWidth={w * 0.1}
        strokeLinecap="round"
      />
      <rect
        x={(w - body) / 2}
        y={w * 0.38}
        width={body}
        height={w * 0.5}
        rx={w * 0.08}
        fill="rgba(12,14,20,0.92)"
        stroke={chrome.brass[300]}
        strokeWidth={w * 0.07}
      />
      {/* The keyhole. Two shapes, because a circle alone reads as a rivet. */}
      <circle cx={w / 2} cy={w * 0.58} r={w * 0.075} fill={chrome.brass[300]} />
      <rect
        x={w / 2 - w * 0.03}
        y={w * 0.58}
        width={w * 0.06}
        height={w * 0.16}
        fill={chrome.brass[300]}
      />
    </g>
  );
}

function paintFor(state: PlotState, lit: boolean): Paint {
  if (state === 'vacant' || state === 'locked') {
    return lit ? LIT_SCRIM[state] : SCRIM[state];
  }
  if (lit) return LIT;
  return state === 'working' ? WORKING : CLEAR;
}

export function DistrictScene({
  buildings,
  queue,
  selected,
  onSelect,
  readOnly = false,
}: DistrictSceneProps) {
  const plate = deliveredUrl({ type: 'plate', plate: 'district' });
  // Hover and focus are held in React rather than left to CSS because the name plate is an HTML
  // element outside the `<svg>`: no selector reaches from a polygon to it, and putting the plates
  // inside the SVG would mean re-implementing a bordered, letter-spaced, font-swapping label in
  // `<text>`, which is the one part of this screen that already works.
  const [pointed, setPointed] = useState<BuildingKind | null>(null);
  const [frameRef, room] = useMeasuredSize();
  const [bandRef, band] = useMeasuredSize();
  const scene = fitted(room, band, !readOnly);

  const sites = DISTRICT_SITES_BY_DEPTH.map((site) => {
    const level = buildingLevel(buildings, site.kind);
    const state: PlotState = queue.some((entry) => entry.kind === site.kind)
      ? 'working'
      : level > 0
        ? 'standing'
        : isBuildingUnlocked(site.kind, buildings)
          ? 'vacant'
          : 'locked';
    return { site, level, state };
  }).filter(({ level }) => !readOnly || level > 0);

  return (
    // The whole painting, fitted to whatever room the chrome leaves, and **never** cropped.
    //
    // Cover was the obvious way to fill a viewport of any shape and it is wrong here: it crops, and
    // there is nothing on this plate that can be cropped. Every outline was traced on the whole
    // painting, so a cut edge is not a lost margin — it is twelve polygons pointing at pixels that
    // have moved.
    <div
      ref={frameRef}
      // No ground of its own. Where the picture cannot reach — a viewport too wide for the shape of
      // the plate — what shows through is the shell's own backdrop, which is this same painting
      // blurred and pushed back. A flat slab of `surface-950` there is the thing that made the
      // district read as a picture sitting on a page; the blur reads as the rest of the city.
      className="absolute inset-0 overflow-hidden"
      data-testid="district-frame"
    >
      {/* The room the floating chrome leaves, as a box rather than as arithmetic.
          `--hud-h` and `--nav-h` are published by the shell from its own measurements, so this
          tracks a HUD that wrapped to a second row or a nav that grew a door, on any viewport,
          without either component knowing the other exists. Read-only means the preview panel on
          the city screen, which has no chrome over it — and would otherwise inherit the shell's
          variables and inset itself inside somebody else's frame. */}
      <div
        ref={bandRef}
        className={cn(
          'absolute left-0 right-0 flex justify-center',
          readOnly ? 'items-center' : 'items-start',
        )}
        style={
          readOnly
            ? { top: 0, bottom: 0 }
            : {
                // `--scene-top`/`--scene-bottom` are what the *screen* adds on top of the shell's
                // own bars — the district's title row, for one. Falling back to the shell's
                // variables keeps the scene correct anywhere it is used without one.
                top: 'var(--scene-top, var(--hud-h, 0px))',
                bottom: 'var(--scene-bottom, var(--nav-h, 0px))',
              }
        }
      >
        <div
          // Sized in pixels, from a measurement, rather than by CSS.
          //
          // The obvious spelling — a percentage width with `aspect-ratio` and a `max-height` — is
          // subtly broken, and broken *silently*: `aspect-ratio` derives the height from the width,
          // and a `max-height` then clamps that height **without giving the width back**. On a short
          // viewport the box quietly stops being the plate's shape, and the image inside it crops to
          // fit. It cost a third of this painting's height once, with every gate green: the outlines
          // still laid out correctly *in the box*, and the box was no longer the picture.
          className="relative"
          style={scene}
          data-testid="district-scene"
        >
          {plate === null ? (
            <Ground />
          ) : (
            <img
              src={plate}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              data-testid="district-plate"
            />
          )}

          {/* The `viewBox` is the plate's own pixel size, so the overlay scales with the picture and
            a stroke stays the same weight in both axes — a `0 0 100 100` box stretched onto a 16:9
            scene draws horizontal edges thinner than vertical ones. */}
          <svg
            viewBox={`0 0 ${DISTRICT_PLATE.width} ${DISTRICT_PLATE.height}`}
            className="absolute inset-0 h-full w-full"
            data-testid="district-plots"
          >
            {sites.map(({ site, level, state }) => {
              const spec = BUILDING_CATALOG[site.kind];
              const lit = !readOnly && (selected === site.kind || pointed === site.kind);
              const paint = paintFor(state, lit);
              return (
                <polygon
                  key={site.kind}
                  points={sitePoints(site)}
                  data-testid={`plot-${site.kind}`}
                  {...(readOnly
                    ? { role: 'img' }
                    : {
                        role: 'button',
                        tabIndex: 0,
                        'aria-pressed': selected === site.kind,
                        onClick: () => onSelect(site.kind),
                        onKeyDown: (event: KeyboardEvent<SVGPolygonElement>) => {
                          // A `<polygon role="button">` is not a `<button>`, so the two keys a button
                          // answers to have to be answered here or the district is mouse-only.
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          onSelect(site.kind);
                        },
                        onPointerEnter: () => setPointed(site.kind),
                        onPointerLeave: () => setPointed((at) => (at === site.kind ? null : at)),
                        onFocus: () => setPointed(site.kind),
                        onBlur: () => setPointed((at) => (at === site.kind ? null : at)),
                      })}
                  aria-label={`${spec.name}, ${describe(state, level, site.kind)}`}
                  fill={paint.fill}
                  stroke={paint.stroke}
                  strokeWidth={paint.strokeWidth}
                  strokeLinejoin="round"
                  {...(paint.dashed === true ? { strokeDasharray: '10 7' } : {})}
                  style={{
                    // `all` rather than the default, so the outline answers the pointer on its
                    // interior even while that interior is painted with a fully transparent fill —
                    // which is what a built structure's resting state is.
                    pointerEvents: readOnly ? 'none' : 'all',
                    ...(paint.blend === undefined ? {} : { mixBlendMode: paint.blend }),
                    ...(lit ? { filter: `drop-shadow(0 0 14px ${chrome.brass[300]}aa)` } : {}),
                    outline: 'none',
                    transition: 'fill 120ms linear, stroke 120ms linear',
                  }}
                />
              );
            })}

            {/* The locks, after every outline so they are never drawn under a neighbour's scrim.
              Sized off the shape they hang on — a lock the same size on the Cistern and on the
              Scrapyard would swamp the one and vanish on the other. */}
            {sites
              .filter(({ state }) => state === 'locked')
              .map(({ site }) => {
                const centre = siteCentroid(site);
                const box = siteBounds(site);
                return (
                  <Padlock
                    key={`lock-${site.kind}`}
                    x={(centre.x / 100) * DISTRICT_PLATE.width}
                    y={(centre.y / 100) * DISTRICT_PLATE.height}
                    size={
                      Math.min(
                        ((box.width / 100) * DISTRICT_PLATE.width) / 2.6,
                        ((box.height / 100) * DISTRICT_PLATE.height) / 2.6,
                      ) || 40
                    }
                  />
                );
              })}
          </svg>

          {/* The name plates, in HTML over the outlines: bordered, letter-spaced display type that
            has to survive a font swap without growing out of the scene. Inert, so the polygon
            underneath is still what the pointer finds. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {sites.map(({ site, level, state }) => {
              const spec = BUILDING_CATALOG[site.kind];
              const shown = selected === site.kind || pointed === site.kind;
              const centre = siteCentroid(site);
              return (
                <span
                  key={site.kind}
                  data-testid={`nameplate-${site.kind}`}
                  style={{ left: `${centre.x}%`, top: `${siteDepth(site)}%` }}
                  className={cn(
                    'absolute z-10 -translate-x-1/2 -translate-y-1/2',
                    'whitespace-nowrap border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.12em]',
                    'transition-opacity',
                    PLATE_STYLES[state],
                    shown || ALWAYS_PLATED.includes(state) ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {spec.shortName} {plate_(state, level)}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The trailing half of a name plate: the level, or the symbol standing in for one. */
function plate_(state: PlotState, level: number): string {
  if (state === 'locked') return '🔒';
  if (state === 'working') return level > 0 ? `Lv ${level} ▲` : '▲';
  return level > 0 ? `Lv ${level}` : '—';
}

/** The same four states in words, for the accessible name. The plate's glyphs say nothing aloud. */
function describe(state: PlotState, level: number, kind: BuildingKind): string {
  switch (state) {
    case 'working':
      return level > 0 ? `level ${level}, upgrade under way` : 'under construction';
    case 'standing':
      return `level ${level}`;
    case 'vacant':
      return 'vacant plot';
    case 'locked':
      return `locked, needs the Nexus at level ${BUILDING_CATALOG[kind].requiresNexusLevel}`;
  }
}

/**
 * The interim ground, drawn until `plate-district` is delivered.
 *
 * No sky and no horizon: the camera looks down at the compound, so the whole frame is ground. What
 * the top of the frame shows is the perimeter the district ends at ({@link DISTRICT_BACK_EDGE}).
 *
 * Deliberately almost bare: a busy placeholder gets read as the design and then argued with. It is
 * a backstop for a missing file rather than a rehearsal of the painting — the outlines are traced
 * on the delivered plate and mean nothing without it, so what this has to do is be obviously not
 * the district rather than pretend to be it.
 *
 * Stretched to the scene box rather than fitted, so there is never a letterbox band of bare surface
 * at any aspect the frame ends up at.
 */
function Ground() {
  const { abyss, smog, ferrite } = ramps;
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        {/* One gradient per band, each starting on the value the road above it ends on, so the
            three read as one slope away from the viewer rather than three stripes. */}
        <linearGradient id="district-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={smog[950]} />
          <stop offset="100%" stopColor={ferrite[950]} />
        </linearGradient>
        <linearGradient id="district-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={smog[700]} />
          <stop offset="100%" stopColor={ferrite[950]} />
        </linearGradient>
        <linearGradient id="district-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ferrite[700]} />
          <stop offset="100%" stopColor={abyss[950]} />
        </linearGradient>
      </defs>

      {/* The whole frame is dirt; the bands sit on top of it, so a road is the ground showing. */}
      <rect x="0" y="0" width="200" height="100" fill={abyss[700]} />
      <rect x="0" y="0" width="200" height={DISTRICT_BACK_EDGE} fill={abyss[950]} />

      {ROW_BANDS.map((band) => (
        <rect
          key={band.top}
          x="0"
          y={band.top}
          width="200"
          height={band.bottom - band.top}
          fill={band.fill}
        />
      ))}

      {/* The lanes between the rows, and the lit lip where each band steps down into one. */}
      {ROW_BANDS.map((band) => (
        <rect
          key={`lip-${band.bottom}`}
          x="0"
          y={band.bottom - 0.5}
          width="200"
          height="0.5"
          fill={ferrite[500]}
          opacity="0.28"
        />
      ))}

      {/* Ground furniture, kept faint: worn patches in the dirt. */}
      <g fill={abyss[950]} opacity="0.22">
        <ellipse cx="52" cy="35" rx="24" ry="2.5" />
        <ellipse cx="146" cy="68" rx="28" ry="3" />
        <ellipse cx="30" cy="99" rx="26" ry="2.5" />
      </g>
    </svg>
  );
}

/** Where each band of the stand-in ground starts and ends, percent of scene height. */
const ROW_BANDS = [
  { top: DISTRICT_BACK_EDGE, bottom: 30, fill: 'url(#district-far)' },
  { top: 36, bottom: 64, fill: 'url(#district-mid)' },
  { top: 70, bottom: 100, fill: 'url(#district-near)' },
] as const;
