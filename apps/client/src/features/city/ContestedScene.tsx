import { LOCATION_CATALOG, plateAspect, type District, type LocationView } from '@frontline/shared';
import type { ReactNode } from 'react';
import { deliveredUrl } from '../../assets/delivered';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { GATE_MARK, LOCATION_MARKS, type Mark } from './marks';

/**
 * A contested district as a place (board request): the painting, with a sign on each location.
 *
 * The screen underneath this is a grid of seven cards, and it stays: cards are where the numbers,
 * the garrison and the Call a fight control live, and none of that fits on a sign. What the grid
 * could never say is *where anything is*. A player who had taken the Tideline Market and the
 * Chandlery had no way to know they were at opposite ends of the same quay, so the district read as
 * a list of seven unrelated errands rather than as ground.
 *
 * Same arrangement as the home district's ground, and for the same reasons written up at length in
 * `DistrictScene`: the painting is finished art with the buildings already in it, so nothing is
 * pasted on top of it. What this adds is a row of **signs**, one per location, hung at the feature
 * each one names. A sign is legible at a glance, always in the same place, and has an obvious hit
 * box; a traced silhouette is a shape the player has to go and find.
 *
 * Every sign is a `HoverCard`, so it explains itself on hover *and* on focus, and clicking it takes
 * the player to that location's card. One control, two jobs, and reachable from a keyboard.
 */

interface ContestedSceneProps {
  district: District;
  locations: readonly LocationView[];
  /** The crew reading the screen, so a sign can say "yours" rather than naming you back at you. */
  baseId: string | undefined;
  /** The way in, when the district draws one. `null` when the district has no gate standing. */
  gate: { shut: boolean; brokenUntil: string | null } | null;
  /** Called with a location id when a sign is clicked. */
  onPick: (locationId: string) => void;
}

/** Whether this district has a painting at all. Everything else here is keyed off it. */
export function hasPainting(districtId: string): boolean {
  return deliveredUrl({ type: 'plate', plate: `district-${districtId}` }) !== null;
}

export function ContestedScene({ district, locations, baseId, gate, onPick }: ContestedSceneProps) {
  const url = deliveredUrl({ type: 'plate', plate: `district-${district.id}` });
  if (url === null) return null;

  const gateMark = GATE_MARK[district.id];
  const marked = locations.filter((view) => LOCATION_MARKS[view.location.id] !== undefined);
  /*
   * Everything the painting has no mark for, so it is still reachable.
   *
   * This is the case the art policy creates on purpose: a correctly named file dropped into
   * `assets/` turns a district into a painting with **no TypeScript edit**, which means a plate can
   * arrive before anybody has placed its signs. Filtering the unmarked ones out was silently fatal
   * once the district became a screen: the card column that used to sit under the painting is gone,
   * so a plate with no marks made all seven locations unreachable, with nothing on screen to say
   * so. `marks.ts` already promised this row existed; it did not.
   */
  const unmarked = locations.filter((view) => LOCATION_MARKS[view.location.id] === undefined);

  /**
   * Every sign whose plate had to move off its point, and the line each of them needs.
   *
   * Only those: a plate hanging beside its own point draws its dot inside its own box and needs no
   * line, because there is nothing to join up.
   */
  const leaders = [
    ...marked.map((view) => ({ key: view.location.id, mark: LOCATION_MARKS[view.location.id]! })),
    ...(gate !== null && gateMark !== undefined
      ? [{ key: `gate-${district.id}`, mark: gateMark }]
      : []),
  ]
    .filter((entry) => entry.mark.plate !== undefined)
    .map((entry) => ({
      key: entry.key,
      from: { x: entry.mark.x, y: entry.mark.y },
      to: entry.mark.plate!,
    }));

  return (
    <div
      className="relative w-full overflow-hidden rounded-sm border border-surface-700"
      // The painting's own shape, read from the manifest rather than typed here. A literal ratio
      // beside the marks is a second copy of the same number with no gate on it: the plate gets
      // re-delivered at a new shape, the picture draws correctly, and all seven signs slide off
      // the buildings they name by an amount that varies with the window.
      style={{ aspectRatio: plateAspect(`district-${district.id}`) }}
      data-testid={`district-painting-${district.id}`}
    >
      <img
        src={url}
        alt={`${district.name}, from above`}
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />

      {/*
       * The leader lines, and the points they run to.
       *
       * One layer for all of them rather than a line per sign, because a line has to be drawn in the
       * painting's coordinates and a sign is positioned in its own: a dot rendered inside the sign's
       * box can only ever be beside the sign, which is the constraint that had every plate sitting
       * on the building it names.
       *
       * `viewBox="0 0 100 100"` with `preserveAspectRatio="none"` makes the SVG's coordinates the
       * same percentages the marks are written in, so a line is the two fractions and nothing else.
       * `vector-effect` then keeps the stroke one pixel wide, which that same non-uniform scale
       * would otherwise stretch into a wedge.
       */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-[9] h-full w-full"
      >
        {leaders.map((leader) => (
          <g key={leader.key} className="text-brass-300/70">
            <line
              x1={leader.from.x * 100}
              y1={leader.from.y * 100}
              x2={leader.to.x * 100}
              y2={leader.to.y * 100}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      {leaders.map((leader) => (
        <span
          key={leader.key}
          aria-hidden
          style={{ left: `${leader.from.x * 100}%`, top: `${leader.from.y * 100}%` }}
          className="pointer-events-none absolute z-[9] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface-950/80 bg-brass-300"
        />
      ))}

      {marked.map((view) => (
        <Sign
          key={view.location.id}
          mark={LOCATION_MARKS[view.location.id]!}
          testId={`site-${view.location.id}`}
          name={view.location.name}
          held={view.holder.kind === 'crew' && view.holder.baseId === baseId}
          onActivate={() => onPick(view.location.id)}
          card={
            <div className="flex flex-col gap-1.5">
              <p className="font-display text-[11px] uppercase tracking-[0.12em] text-brass-300">
                {view.location.name}
              </p>
              <p className="font-body text-[12px] leading-relaxed text-ink-200">
                {LOCATION_CATALOG[view.location.kind].blurb}
              </p>
              <p className="font-body text-[12px] leading-relaxed text-verdigris-100">
                {LOCATION_CATALOG[view.location.kind].reward}
              </p>
            </div>
          }
        />
      ))}

      {unmarked.length > 0 && (
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap justify-center gap-1.5 bg-surface-950/75 px-3 py-2 backdrop-blur-sm"
          data-testid="unplaced-locations"
        >
          {unmarked.map((view) => (
            <button
              key={view.location.id}
              type="button"
              data-testid={`site-${view.location.id}`}
              onClick={() => onPick(view.location.id)}
              className="rounded-sm border border-brass-300/50 bg-surface-950/85 px-2 py-0.5 font-display text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] text-brass-100 hover:border-brass-300"
            >
              {view.location.name}
            </button>
          ))}
        </div>
      )}

      {gate !== null && gateMark !== undefined && (
        <Sign
          mark={gateMark}
          testId={`site-gate-${district.id}`}
          name="District Gate"
          held={false}
          shut={gate.shut}
          onActivate={() => onPick('gate')}
          card={
            <div className="flex flex-col gap-1.5">
              <p className="font-display text-[11px] uppercase tracking-[0.12em] text-brass-300">
                District Gate
              </p>
              <p className="font-body text-[12px] leading-relaxed text-ink-200">
                {gate.shut
                  ? 'One party holds every location in here, so there is no way in but the front.'
                  : 'Standing open. Everything behind it can be reached without breaking anything.'}
              </p>
            </div>
          }
        />
      )}
    </div>
  );
}

/**
 * One sign, hung at its mark.
 *
 * `-translate-y-1/2` centres it on the point, and the horizontal translate hangs it off whichever
 * side {@link Mark} asked for, so a sign near the frame edge stays on the picture instead of being
 * clipped by the `overflow-hidden` above. `max-w` is what keeps a long name from reaching the far
 * edge on a narrow window: the name wraps to two lines rather than the plate growing off frame.
 */
function Sign({
  mark,
  testId,
  name,
  held,
  shut = false,
  card,
  onActivate,
}: {
  mark: Mark;
  testId: string;
  name: string;
  held: boolean;
  shut?: boolean;
  card: ReactNode;
  onActivate: () => void;
}) {
  // Where the plate hangs. Beside the point on an open picture; somewhere quieter, with a line back
  // to the point, when hanging it beside would put it on the roof it is naming.
  const at = mark.plate ?? mark;
  return (
    <span
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
      className={cn(
        'absolute z-10 -translate-y-1/2',
        mark.side === 'right' ? 'translate-x-2' : 'translate-x-[calc(-100%-0.5rem)]',
      )}
    >
      <HoverCard
        data-testid={testId}
        label={`${name}: what it is and what holding it pays`}
        onActivate={onActivate}
        card={card}
        className="transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0"
      >
        <span
          className={cn(
            'flex max-w-[9rem] items-center gap-1.5 rounded-sm border px-2 py-0.5 text-left',
            'font-display text-[10px] font-semibold uppercase leading-tight tracking-[0.09em] shadow-lifted',
            held
              ? 'border-verdigris-300/70 bg-surface-950/85 text-verdigris-100'
              : 'border-brass-300/50 bg-surface-950/85 text-brass-100',
          )}
        >
          {shut && <Icon name="lock" aria-hidden className="h-3 w-3 shrink-0 text-brass-300" />}
          <span className="min-w-0">{name}</span>
        </span>
      </HoverCard>
      {/* The point the sign names, so the eye can tie the two together. Never a hit target: the
          sign is the control. Drawn here only when the plate is beside its point; a plate that had
          to move gets its dot and its line from the layer under all of them, because a dot
          positioned inside this box cannot be placed anywhere else on the picture. */}
      {mark.plate === undefined && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full',
            'border border-surface-950/80 bg-brass-300',
            mark.side === 'right' ? '-left-2.5' : '-right-2.5',
          )}
        />
      )}
    </span>
  );
}
