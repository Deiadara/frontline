import { BUILDING_CATALOG, type Building, type BuildingKind } from '@frontline/shared';
import { cn } from '../../lib/cn';
import { ramps } from '../../theme/tokens';
import { StructureSprite } from './sprites';
import { VILLAGE_ASPECT, VILLAGE_HORIZON, VILLAGE_PLOTS } from './plots';

/**
 * The hideout as a place (GDD §A1): six discrete, clickable structures standing on ground, which
 * is what replaces the old single-panel list of rows. Clicking a plot opens its dialog — the
 * Grepolis move — so the scene itself never has to make room for a detail column and can use the
 * full width at every supported viewport.
 */

interface VillageProps {
  buildings: readonly Building[];
  selected: BuildingKind | null;
  onSelect: (kind: BuildingKind) => void;
}

export function Village({ buildings, selected, onSelect }: VillageProps) {
  return (
    <div
      className="relative w-full overflow-hidden border border-neon-cyan/20 bg-night"
      style={{ aspectRatio: VILLAGE_ASPECT }}
      data-testid="village-scene"
    >
      <Ground />
      {VILLAGE_PLOTS.map((plot) => {
        const standing = buildings.find((building) => building.kind === plot.kind);
        const spec = BUILDING_CATALOG[plot.kind];
        return (
          <button
            key={plot.kind}
            type="button"
            aria-pressed={selected === plot.kind}
            aria-label={`${spec.name} — ${standing ? `level ${standing.level}` : 'vacant plot'}`}
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
            )}
          >
            <span className="min-h-0 w-full flex-1">
              <StructureSprite kind={plot.kind} built={standing !== undefined} />
            </span>
            <span
              data-testid={`plot-label-${plot.kind}`}
              className={cn(
                'whitespace-nowrap border px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.12em]',
                standing
                  ? 'border-steel-700 bg-night/90 text-steel-200'
                  : 'border-dashed border-steel-600 bg-night/90 text-steel-500',
              )}
            >
              {spec.shortName} {standing ? `Lv ${standing.level}` : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The place the village sits in: sodium haze over an undercity skyline, then the scrap yard the
 * plots stand on (§A2 — broken-down, not chrome).
 *
 * Stretched to the scene box rather than fitted, so there is never a letterbox band of bare surface
 * at any aspect the frame ends up at. The skyline's baseline is {@link VILLAGE_HORIZON}, the same
 * number the back row's plots end on, so the far structures stand *on* the ground line instead of
 * floating over it — one constant, not two that have to be kept in sync by eye.
 */
function Ground() {
  const { abyss, smog, ferrite, ember, bile } = ramps;
  const horizon = VILLAGE_HORIZON;
  return (
    <svg
      viewBox="0 0 200 100"
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="village-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={abyss[950]} />
          <stop offset="65%" stopColor={abyss[500]} />
          <stop offset="100%" stopColor={smog[700]} />
        </linearGradient>
        {/* Starts on the far silhouette's own colour, so the ground arrives without a seam. */}
        <linearGradient id="village-dirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={abyss[700]} />
          <stop offset="45%" stopColor={ferrite[950]} />
          <stop offset="100%" stopColor={abyss[950]} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="200" height={horizon} fill="url(#village-sky)" />

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

      <rect x="0" y={horizon} width="200" height={100 - horizon} fill="url(#village-dirt)" />
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
