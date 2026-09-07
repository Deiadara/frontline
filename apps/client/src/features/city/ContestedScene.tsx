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
 * One sign, standing at its mark.
 *
 * Centred on the mark's `x` with its top edge at `y`, which the marks put just under the feature
 * each names, the way a plot label sits under a building. No dot and no line: the sign's position
 * is the whole statement. `max-w` keeps a long name wrapping to two lines rather than growing the
 * plate off the frame on a narrow window, and `side` turns the two right-edge signs inward.
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
  return (
    <span
      style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
      className={cn(
        'absolute z-10',
        // Centred on its mark and hung from it, like a plot label under a building. At the two
        // frame edges the sign grows inward instead, so it stays inside the `overflow-hidden`.
        mark.side === 'left'
          ? '-translate-x-full'
          : mark.side === 'right'
            ? 'translate-x-0'
            : '-translate-x-1/2',
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
    </span>
  );
}
