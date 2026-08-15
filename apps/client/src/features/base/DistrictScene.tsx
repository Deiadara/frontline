import {
  BUILDING_CATALOG,
  buildingLevel,
  isBuildingUnlocked,
  type Building,
  type BuildingKind,
  type BuildQueue,
} from '@frontline/shared';
import { deliveredUrl } from '../../assets/delivered';
import { cn } from '../../lib/cn';
import { ramps } from '../../theme/tokens';
import { StructureSprite } from './sprites';
import {
  DISTRICT_ASPECT,
  DISTRICT_BACK_EDGE,
  DISTRICT_SITES_BY_DEPTH,
  siteBox,
  type DistrictSite,
} from './plots';

/**
 * The district as a place (GDD §A1): one painted ground, with thirteen structures standing on it.
 *
 * The Grepolis move, and the reason the structures are cutouts with an alpha channel rather than
 * tiles: nothing frames them. A plot has no border, no panel, no hover fill — it is the drawing of
 * the building, sitting on the drawing of the ground, and everything that makes it feel *placed*
 * rather than pasted is done per-pixel through the sprite's own alpha:
 *
 *   * a **contact shadow** pooled at the ground line, so it stands on the terrace instead of
 *     hovering over it;
 *   * **atmospheric haze** tinted into the sprite and weighted by depth, so the back terrace sits
 *     behind the front one the way the painted ground does;
 *   * a **rim glow** on hover and focus that follows the silhouette, because a rectangle drawn
 *     around a building is the one thing that would give the trick away.
 *
 * A plot is in one of four states, and each has to be legible at a glance: standing, being worked
 * on, empty and buildable, or empty and locked behind the Nexus. Names are shown on hover and focus
 * rather than always — a permanent plate on each of thirteen structures is the other thing that
 * would undo the blend — but `working` and `locked` keep a small always-visible marker, because
 * those two are what a player scans the district *for*.
 */

interface DistrictSceneProps {
  buildings: readonly Building[];
  queue: BuildQueue;
  selected: BuildingKind | null;
  onSelect: (kind: BuildingKind) => void;
}

/** The four states a plot can be in, in the order the label prefers to report them. */
type PlotState = 'working' | 'standing' | 'vacant' | 'locked';

const PLATE_STYLES: Record<PlotState, string> = {
  working: 'border-ember-300/70 bg-night/90 text-ember-300',
  standing: 'border-steel-700 bg-night/90 text-steel-200',
  vacant: 'border-dashed border-steel-600 bg-night/90 text-steel-500',
  locked: 'border-dashed border-steel-700 bg-night text-steel-400',
};

/**
 * The states that keep a name plate even when the player is not pointing at them — which is every
 * state except a structure that is simply standing.
 *
 * The blend the scene is built for is a blend of *buildings* into painted ground. An empty plot has
 * no building to blend: it is a survey marker, and the only thing it can tell a player is which
 * structure would go there and whether they may build it yet. Hiding that behind a hover made the
 * one plot worth clicking — vacant and unlocked — the only plot with nothing written on it.
 */
const ALWAYS_PLATED: readonly PlotState[] = ['working', 'vacant', 'locked'];

export function DistrictScene({ buildings, queue, selected, onSelect }: DistrictSceneProps) {
  const plate = deliveredUrl({ type: 'plate', plate: 'district' });

  return (
    <div
      className="relative w-full overflow-hidden border border-neon-cyan/20 bg-night"
      style={{ aspectRatio: DISTRICT_ASPECT }}
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

      {DISTRICT_SITES_BY_DEPTH.map((site) => {
        const spec = BUILDING_CATALOG[site.kind];
        const level = buildingLevel(buildings, site.kind);
        const working = queue.some((entry) => entry.kind === site.kind);
        const state: PlotState = working
          ? 'working'
          : level > 0
            ? 'standing'
            : isBuildingUnlocked(site.kind, buildings)
              ? 'vacant'
              : 'locked';
        const box = siteBox(site);

        return (
          <button
            key={site.kind}
            type="button"
            aria-pressed={selected === site.kind}
            aria-label={`${spec.name} — ${describe(state, level, site.kind)}`}
            onClick={() => onSelect(site.kind)}
            data-testid={`plot-${site.kind}`}
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
            }}
            className={cn(
              'group absolute block bg-transparent p-0 focus:outline-none',
              // Locked plots stay clickable — the dialog is where a player finds out what would
              // unlock them, and a plot that cannot be clicked cannot tell them.
              state === 'locked' && 'opacity-60',
            )}
          >
            <ContactShadow visible={level > 0} />
            <StructureSprite
              kind={site.kind}
              built={level > 0}
              haze={hazeFor(site)}
              lit={selected === site.kind}
            />
            <span
              data-testid={`plot-label-${site.kind}`}
              className={cn(
                'pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 -translate-y-1/2',
                'whitespace-nowrap border px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.12em]',
                'transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
                PLATE_STYLES[state],
                selected === site.kind || ALWAYS_PLATED.includes(state)
                  ? 'opacity-100'
                  : 'opacity-0',
              )}
            >
              {spec.shortName} {plate_(state, level)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * How much of the district's haze is mixed into a structure, 0–1.
 *
 * Taken off the site's ground line rather than its size, because depth is where it stands and not
 * how big it was drawn — a small structure at the front is *near*. Linear between the horizon and
 * the bottom of the scene, and capped well below 1: this is meant to seat a cutout in the painting,
 * not to fog it out.
 */
export const MAX_STRUCTURE_HAZE = 0.24;

export function hazeFor(site: DistrictSite): number {
  const depth = (100 - site.baseline) / (100 - DISTRICT_BACK_EDGE);
  return Math.max(0, Math.min(1, depth)) * MAX_STRUCTURE_HAZE;
}

/**
 * The pool of shade a structure sits in.
 *
 * Drawn as its own ellipse rather than as a `drop-shadow` of the sprite: a drop shadow is the
 * silhouette offset, which is a shadow cast on a *wall*. What seats a building on ground seen from
 * above is a soft pool under its footprint, wider than it is tall.
 */
function ContactShadow({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-1/2 h-[14%] w-[86%] -translate-x-1/2 translate-y-1/3"
      style={{
        background: `radial-gradient(closest-side, ${ramps.abyss[950]}cc, transparent)`,
      }}
    />
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
 * Three bands of dirt with a lane of road between them, matching the site table's three rows —
 * which is the shape `plate-district` has to be painted in, so the stand-in is a rehearsal of it
 * rather than a different place. Deliberately almost bare: a busy placeholder gets read as the
 * design and then argued with.
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

      {/* Ground furniture, kept faint and outside the pads: worn patches in the dirt. */}
      <g fill={abyss[950]} opacity="0.22">
        <ellipse cx="52" cy="35" rx="24" ry="2.5" />
        <ellipse cx="146" cy="68" rx="28" ry="3" />
        <ellipse cx="30" cy="99" rx="26" ry="2.5" />
      </g>
    </svg>
  );
}

/**
 * Where each row's ground band starts and ends, percent of scene height.
 *
 * The gaps between them are the site table's clear lanes — `plots.test.ts` pins that no structure
 * ever stands in one, so a band edge can never cut a building off at the knees.
 */
const ROW_BANDS = [
  { top: DISTRICT_BACK_EDGE, bottom: 30, fill: 'url(#district-far)' },
  { top: 36, bottom: 64, fill: 'url(#district-mid)' },
  { top: 70, bottom: 100, fill: 'url(#district-near)' },
] as const;
