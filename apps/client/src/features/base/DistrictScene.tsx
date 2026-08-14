import {
  BUILDING_CATALOG,
  buildingLevel,
  isBuildingUnlocked,
  type Building,
  type BuildingKind,
  type BuildQueue,
} from '@frontline/shared';
import { cn } from '../../lib/cn';
import { ramps } from '../../theme/tokens';
import { StructureSprite } from './sprites';
import { DISTRICT_ASPECT, DISTRICT_HORIZON, DISTRICT_PLOTS } from './plots';

/**
 * The district as a place (GDD §A1): thirteen discrete, clickable plots standing on ground, which
 * is what replaces a list of structure rows. Clicking a plot opens its dialog — the Grepolis move —
 * so the scene itself never has to make room for a detail column and can use the full width at
 * every supported viewport.
 *
 * A plot is in exactly one of four states, and each has to be legible at a glance from across the
 * scene: standing, being worked on, empty and buildable, or empty and locked behind the Nexus. The
 * name plate carries all four, because it is the only part of a plot guaranteed to be readable at
 * the smallest supported size.
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

export function DistrictScene({ buildings, queue, selected, onSelect }: DistrictSceneProps) {
  return (
    <div
      className="relative w-full overflow-hidden border border-neon-cyan/20 bg-night"
      style={{ aspectRatio: DISTRICT_ASPECT }}
      data-testid="district-scene"
    >
      <Ground />
      {DISTRICT_PLOTS.map((plot) => {
        const spec = BUILDING_CATALOG[plot.kind];
        const level = buildingLevel(buildings, plot.kind);
        const working = queue.some((entry) => entry.kind === plot.kind);
        const state: PlotState = working
          ? 'working'
          : level > 0
            ? 'standing'
            : isBuildingUnlocked(plot.kind, buildings)
              ? 'vacant'
              : 'locked';

        return (
          <button
            key={plot.kind}
            type="button"
            aria-pressed={selected === plot.kind}
            aria-label={`${spec.name} — ${describe(state, level, plot.kind)}`}
            onClick={() => onSelect(plot.kind)}
            style={{
              left: `${plot.x}%`,
              top: `${plot.y}%`,
              width: `${plot.width}%`,
              height: `${plot.height}%`,
            }}
            className={cn(
              'group absolute flex flex-col items-center justify-end gap-1 border border-transparent p-1 transition-colors',
              'hover:border-neon-cyan/40 focus-visible:border-neon-cyan focus-visible:outline-none',
              selected === plot.kind && 'border-neon-cyan/70 bg-neon-cyan/5',
              // Locked plots stay clickable — the dialog is where a player finds out what would
              // unlock them, and a plot that cannot be clicked cannot tell them. Dimmed only to
              // 60%: the back row is drawn against the skyline, and 45% put its name plates below
              // the point where they could be read at 1024px.
              state === 'locked' && 'opacity-60',
            )}
          >
            <span className="min-h-0 w-full flex-1">
              <StructureSprite kind={plot.kind} built={level > 0} />
            </span>
            <span
              data-testid={`plot-label-${plot.kind}`}
              className={cn(
                'whitespace-nowrap border px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.12em]',
                PLATE_STYLES[state],
              )}
            >
              {spec.shortName} {plate(state, level)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The trailing half of a name plate: the level, or the symbol standing in for one. */
function plate(state: PlotState, level: number): string {
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
 * The place the district sits in: sodium haze over an undercity skyline, then the scrap yard the
 * plots stand on (§A2 — broken-down, not chrome).
 *
 * Stretched to the scene box rather than fitted, so there is never a letterbox band of bare surface
 * at any aspect the frame ends up at. The skyline's baseline is {@link DISTRICT_HORIZON}, the same
 * number the back row's plots end on, so the far structures stand *on* the ground line instead of
 * floating over it — one constant, not two that have to be kept in sync by eye.
 */
function Ground() {
  const { abyss, smog, ferrite, ember, bile } = ramps;
  const horizon = DISTRICT_HORIZON;
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="district-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={abyss[950]} />
          <stop offset="65%" stopColor={abyss[500]} />
          <stop offset="100%" stopColor={smog[700]} />
        </linearGradient>
        {/* Starts on the far silhouette's own colour, so the ground arrives without a seam. */}
        <linearGradient id="district-dirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={abyss[700]} />
          <stop offset="45%" stopColor={ferrite[950]} />
          <stop offset="100%" stopColor={abyss[950]} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="200" height={horizon} fill="url(#district-sky)" />

      {/* Far towers, then a nearer, darker row — the depth behind the settlement. */}
      <g transform={`translate(0 ${horizon})`}>
        <path
          d="M0-16h12v-11h9v11h11v-18h10v18h14v-9h11v9h15v-15h9v15h16v-10h10v10h13v-14h10v14h14v-8h10v8h15v-13h9v13h12V0H0Z"
          fill={smog[950]}
        />
        <g fill={ember[300]} opacity="0.55">
          <rect x="15" y="-24" width="1.4" height="2" />
          <rect x="35" y="-30" width="1.4" height="2" />
          <rect x="38" y="-25" width="1.4" height="2" />
          <rect x="93" y="-26" width="1.4" height="2" />
          <rect x="146" y="-22" width="1.4" height="2" />
        </g>
        <rect x="115" y="-21" width="1.4" height="2" fill={bile[300]} opacity="0.5" />
        <path
          d="M0-8h17v-7h10v7h15v-12h11v12h17v-6h11v6h16v-10h10v10h17v-8h11v8h20v-9h9v9h9V0H0Z"
          fill={abyss[700]}
        />
      </g>

      <rect x="0" y={horizon} width="200" height={100 - horizon} fill="url(#district-dirt)" />
      {/* Scrap yard: the track the near row stands beside, spoil heaps, and a run of dead pipe. */}
      <path
        d={`M4 ${horizon + 26}q18-6 34 0t34 0 34 0 34 0 34 0`}
        fill="none"
        stroke={ferrite[950]}
        strokeWidth="1"
      />
      <path d={`M12 ${horizon + 4}l4-3 4 3Z`} fill={ferrite[700]} opacity="0.35" />
      <path d={`M176 ${horizon + 5}l5-4 5 4Z`} fill={ferrite[700]} opacity="0.35" />
      <path d={`M99 ${horizon + 3}l3-2 3 2Z`} fill={ferrite[700]} opacity="0.3" />
    </svg>
  );
}
