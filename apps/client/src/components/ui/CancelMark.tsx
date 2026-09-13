import { Icon } from './Icon';
import { cn } from '../../lib/cn';
import { formatRemaining } from '../../features/base/format';

/**
 * The one way to change your mind (maintainer request, 2026-09-12).
 *
 * Anything that takes time can be called off in the first tenth of its own clock, and this is
 * what that looks like everywhere: an X on an oxblood plate with the same drawn stroke the
 * buttons carry, and beside it how long is left to decide. A build, a batch, a project, a dig, a
 * scout, a crew on a job and a column on the road all wore a different control before this (a
 * ghost "Cancel", a ghost "Call them back", a ghost "Turn them around", or nothing), so whether a
 * misclick was recoverable, and how to recover it, depended on which screen it happened on.
 *
 * It draws nothing once the window is shut. A dead control that is on screen almost all the
 * time is a control a player stops seeing, and the one moment it matters is the moment it is live.
 * The countdown is the caller's arithmetic against the server's clock (`useServerClock`); this
 * only says it.
 *
 * `formatRemaining` is the district page's two-unit duration (`2m 10s`), imported from there
 * rather than copied: it is the shape every other countdown in the game reads in.
 */
export function CancelMark({
  windowMs,
  label,
  pending,
  onCancel,
  tip,
  className,
  'data-testid': testId,
}: {
  /** Milliseconds left to decide. At or below zero the control is not drawn. */
  windowMs: number;
  /** What the press calls off, as the button's accessible name: "Call off the Quarters level 4". */
  label: string;
  /** The write is in flight: the button is dead until it settles, so it cannot be pressed twice. */
  pending: boolean;
  onCancel: () => void;
  /** An optional tooltip, for the places that want to say what comes back. */
  tip?: string;
  className?: string;
  'data-testid': string;
}) {
  if (windowMs <= 0) return null;

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={onCancel}
        data-testid={testId}
        data-tip={tip}
        // The ordinary click rather than the confirm, like every other secondary action.
        data-sound="click"
        className={cn(
          'brushed relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border',
          'border-oxblood-500 bg-oxblood-500/90 text-ink-100 shadow-lifted transition-all duration-100',
          'hover:bg-oxblood-300 active:translate-y-px active:shadow-none',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:active:translate-y-0',
        )}
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
      <span
        className="min-w-0 truncate font-display text-[11px] uppercase tracking-[0.14em] tabular-nums text-ink-300"
        data-testid={`${testId}-window`}
      >
        {formatRemaining(windowMs)} left to decide
      </span>
    </span>
  );
}
