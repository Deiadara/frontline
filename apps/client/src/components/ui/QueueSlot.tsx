import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * One place in a queue that holds a fixed number of things (maintainer, 2026-10-08).
 *
 * The bench and the training floor draw every place they have, taken or free, so an order landing
 * fills a box that was already there rather than growing the page by a row, and the player can see
 * how many more the queue takes without reading a fraction. A taken place and a free one are the
 * same box at the same size; only what is in it differs.
 *
 * The edge is the quiet one the training floor's chips already wore, so a queue reads as the same
 * kind of thing on every screen. The place being worked is ringed in brass.
 */
export function QueueSlot({
  head = false,
  className,
  children,
  'data-testid': testId,
  ...rest
}: {
  /** The one actually running; the rest wait behind it. */
  head?: boolean;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
  'data-tip'?: string;
  'data-queued'?: true | undefined;
}) {
  return (
    <li
      className={cn(
        // Solid enough to read as a box on any ground (maintainer, 2026-10-08: "less see
        // through"), with an edge a step brighter than the ground's.
        'flex min-w-0 items-center gap-2 rounded-sm border bg-surface-950/80 px-2 shadow-[inset_0_1px_0_rgb(222_216_240/0.06)]',
        head ? 'border-brass-300/70' : 'border-surface-500/80',
        className,
      )}
      data-testid={testId}
      {...rest}
    >
      {children}
    </li>
  );
}

/** A free place: the same box, ruled in dashes, with its number in it. */
export function EmptyQueueSlot({
  place,
  className,
  'data-testid': testId,
}: {
  /** Which place this is, counting from one. */
  place: number;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <li
      className={cn(
        'flex min-w-0 items-center justify-center rounded-sm border border-dashed border-surface-500/80 bg-surface-950/45 px-2',
        className,
      )}
      data-testid={testId}
      aria-label={`Place ${place}, free`}
    >
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
        {place} · Free
      </span>
    </li>
  );
}
