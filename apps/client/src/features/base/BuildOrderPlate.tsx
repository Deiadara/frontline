import {
  BUILDING_CATALOG,
  queueCancelCascade,
  queueCancelWindowMs,
  queueClockMs,
  queueProgressAt,
  queueWaiting,
  type Base,
  type BuildQueueEntry,
} from '@frontline/shared';
import { CancelCell } from '../../components/ui/CancelMark';
import { cn } from '../../lib/cn';
import { formatRemaining } from './format';

/**
 * One build order, as the district's rail draws it (§A1).
 *
 * Shared with the plot dialog (maintainer, 2026-10-08): a level on the clock looks the same in the
 * window that took the order as it does down the side of the district, so a player who has learnt
 * one has learnt the other.
 *
 * One fixed height, open window or shut: the X lives in a cell on the right that keeps its room
 * after the X has faded out of it, so a plate is the same box from the moment it lands to the
 * moment it is built.
 */
export function BuildOrderPlate({
  entry,
  base,
  now,
  worked,
  pending,
  onCancel,
  cancelTestId,
  after = 0,
  className,
  'data-testid': testId,
}: {
  entry: BuildQueueEntry;
  /** The district the order is in: whether it can still be called off depends on the rest of it. */
  base: Base;
  now: Date;
  /** The order the builders are on. The ones waiting behind it read quieter. */
  worked: boolean;
  pending: boolean;
  onCancel: () => void;
  cancelTestId: string;
  /** More levels of the same structure queued behind this one, said beside the level. */
  after?: number;
  className?: string;
  'data-testid'?: string;
}) {
  const name = BUILDING_CATALOG[entry.kind].name;
  const waiting = queueWaiting(entry, now);
  return (
    <div
      data-testid={testId}
      className={cn(
        'glass edge-lit flex h-[3.75rem] items-center gap-2 rounded-sm border py-2 pl-3 pr-2',
        worked ? 'border-brass-300/60' : 'border-surface-600/80 opacity-80',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The name has the line to itself and the countdown sits under it, beside the level:
            with the cell on the right, a name and a clock on one line left "The Apothecary" no
            room. */}
        <span className="whitespace-nowrap font-display text-[11px] uppercase leading-none tracking-[0.12em] text-ink-200">
          {name}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="whitespace-nowrap font-display text-[10px] uppercase leading-none tracking-[0.14em] text-ink-400">
            to Lv {entry.level}
            {after > 0 && <span className="text-ink-300">, {after} more after</span>}
          </span>
          <span className="shrink-0 font-display text-[12px] font-bold leading-none tabular-nums text-brass-300">
            {/* Only the order being worked counts down (maintainer, 2026-10-08); one waiting its turn
                shows its whole clock and holds it. */}
            {formatRemaining(queueClockMs(entry, now))}
          </span>
        </div>
        <span className="paint-track mt-0.5 block h-1 w-full rounded-[1px]">
          <span
            className={cn('paint-fill block h-full', worked ? 'bg-brass-300' : 'bg-surface-600')}
            style={{ width: `${queueProgressAt(entry, now) * 100}%` }}
          />
        </span>
      </div>
      <CancelCell
        windowMs={queueCancelWindowMs(entry, now)}
        queued={waiting}
        label={`Call off ${name} level ${entry.level}`}
        {...withTip(alsoCalledOff(entry, base))}
        pending={pending}
        onCancel={onCancel}
        data-testid={cancelTestId}
      />
    </div>
  );
}

/**
 * The orders that go with this one when it is called off, said on the X's hover (maintainer,
 * 2026-10-08): Quarters 3 behind Quarters 2 cannot stand once Quarters 2 is gone.
 */
export function alsoCalledOff(entry: BuildQueueEntry, base: Base): string | undefined {
  const falls = queueCancelCascade(base.buildQueue, base.buildings, base.level, entry.id);
  if (falls.length === 0) return undefined;
  const names = base.buildQueue
    .filter((queued) => falls.includes(queued.id))
    .map((queued) => `${BUILDING_CATALOG[queued.kind].name} level ${queued.level}`);
  return `Also calls off ${names.join(', ')}, which ${names.length === 1 ? 'is' : 'are'} built on it. 90% back on each.`;
}

/** A tip prop only when there is something to say: an absent prop rather than an undefined one. */
export function withTip(tip: string | undefined): { tip?: string } {
  return tip === undefined ? {} : { tip };
}
