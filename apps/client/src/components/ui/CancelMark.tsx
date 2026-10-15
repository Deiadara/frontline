import { Icon } from './Icon';
import { cn } from '../../lib/cn';
import { useFadingValue } from '../../lib/useFadingValue';
import { formatRemaining } from '../../features/base/format';

/**
 * The one way to change your mind (maintainer request, 2026-09-12).
 *
 * Anything that takes time can be called off in the first tenth of its own clock, and this is
 * what that looks like everywhere: an X on an oxblood plate with the same drawn stroke the
 * buttons carry, and beside it how long is left to decide. A build, a batch, a project, a dig, a
 * spy job, a crew on a job and a column on the road all wore a different control before this (a
 * ghost "Cancel", a ghost "Call them back", a ghost "Turn them around", or nothing), so whether a
 * misclick was recoverable, and how to recover it, depended on which screen it happened on.
 *
 * Three shapes of the same plate:
 *
 *   * {@link CancelCell}, a fixed cell inside the box of the thing it calls off. What every queue
 *     and every running job uses (maintainer, 2026-10-08).
 *   * {@link CancelBox}, a box of its own beside a single running clock, which says so when the
 *     window has shut rather than going blank. The research project's.
 *   * `CancelMark`, the X with its countdown on one line, for a caller that keeps its own room
 *     (the training banner's `CancelLine`).
 *
 * The countdown is the caller's arithmetic against the server's clock (`useServerClock`); these
 * only say it. `formatRemaining` is the district page's two-unit duration (`2m 10s`), imported
 * from there rather than copied: it is the shape every other countdown in the game reads in.
 */

interface CancelProps {
  /** Milliseconds left to decide. At or below zero the X is not offered. */
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
}

/** How long a shutting window takes to fade out. */
const FADE_MS = 200;

/** The plate itself: an X on oxblood, drawn at the size its caller has room for. */
function CancelButton({
  label,
  pending,
  onCancel,
  tip,
  small,
  'data-testid': testId,
}: Omit<CancelProps, 'windowMs' | 'className'> & { small?: boolean }) {
  return (
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
        'brushed relative inline-flex shrink-0 items-center justify-center rounded-sm border',
        small ? 'h-5 w-5' : 'h-7 w-7',
        'border-oxblood-500 bg-oxblood-500/90 text-ink-100 shadow-lifted transition-all duration-100',
        'hover:bg-oxblood-300 active:translate-y-px active:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:active:translate-y-0',
      )}
    >
      <Icon name="close" className={small ? 'h-3 w-3' : 'h-4 w-4'} />
    </button>
  );
}

/**
 * The X with its countdown on one line. It draws nothing once the window is shut, so a caller that
 * must not move keeps the room itself.
 */
export function CancelMark({
  windowMs,
  queued = false,
  className,
  ...button
}: CancelProps & {
  /** Waiting its turn: no timer, since it can be called off any time before it starts. */
  queued?: boolean;
}) {
  if (windowMs <= 0) return null;

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <CancelButton {...button} />
      <span
        className="min-w-0 truncate font-display text-[11px] uppercase tracking-[0.14em] tabular-nums text-ink-300"
        data-testid={`${button['data-testid']}-window`}
      >
        {queued ? 'Queued: call it off any time' : `${formatRemaining(windowMs)} left to decide`}
      </span>
    </span>
  );
}

/**
 * The window, held through its fade.
 *
 * Fading out needs something to fade, and by the time the window has shut there is nothing live to
 * draw. So the last open window is held for the length of the fade, drawn dead and hidden from the
 * pointer and the screen reader, and then let go. A window already shut on the first render is
 * never drawn at all: a page opening is not a window closing.
 */
function useFadingWindow(windowMs: number) {
  const live = windowMs > 0 ? windowMs : null;
  const { held, lit } = useFadingValue(live, FADE_MS);
  return { held, lit, live: live !== null };
}

/**
 * The X inside the box of the thing it calls off (maintainer, 2026-10-08).
 *
 * The cell is always there and always the same size, open or shut, so a queue box never grows when
 * an order lands in it and never shrinks when its window closes: the X fades out of a room that
 * stays. Before this the mark was a row of its own under the bar, drawn only while the window was
 * open, and every box on every queue jumped twice in the life of an order.
 *
 * Two sizes. `md` stacks the X over its countdown, for a box two or three lines deep (the
 * district's rail, a job on the Actions page). `sm` runs them side by side at twenty pixels, for a
 * one-line row (the training floor, the muster bench).
 */
export function CancelCell({
  windowMs,
  size = 'md',
  flip = false,
  queued = false,
  className,
  ...button
}: CancelProps & {
  size?: 'sm' | 'md';
  /** One line, countdown first and the X last: for a cell set in a box's top right corner. */
  flip?: boolean;
  /**
   * The thing is waiting its turn (maintainer, 2026-10-08): it can be called off at any time until
   * it starts, so the X carries no timer, only the word. The timer is for the one being worked.
   */
  queued?: boolean;
}) {
  const { held, lit, live } = useFadingWindow(windowMs);
  const small = size === 'sm';

  return (
    <span
      className={cn(
        // Only the X takes the pointer: an empty cell laid over a card must not swallow its click.
        'pointer-events-none flex shrink-0',
        small
          ? cn('h-5 w-[4.5rem] items-center gap-1.5', flip ? 'flex-row-reverse' : 'flex-row')
          : 'h-11 w-14 flex-col items-center justify-center gap-1',
        className,
      )}
      // Prefixed rather than suffixed, so a test looking for every X by its prefix
      // (`/^recall-spy-/`) does not find the empty cell an X has left.
      data-testid={`cell-${button['data-testid']}`}
    >
      {held !== null && (
        <span
          className={cn(
            'flex transition-opacity duration-200 ease-out motion-reduce:transition-none',
            small
              ? cn('items-center gap-1.5', flip ? 'flex-row-reverse' : 'flex-row')
              : 'flex-col items-center gap-1',
          )}
          style={{ opacity: lit ? 1 : 0 }}
          aria-hidden={live ? undefined : true}
        >
          <span className="pointer-events-auto flex">
            <CancelButton {...button} small={small} pending={button.pending || !live} />
          </span>
          <span
            className="whitespace-nowrap font-display text-[10px] leading-none tabular-nums text-ink-300"
            data-testid={`${button['data-testid']}-window`}
            data-tip={
              !live
                ? undefined
                : queued
                  ? 'Queued: call it off any time before it starts'
                  : `${formatRemaining(held)} left to decide`
            }
          >
            {queued ? 'queued' : formatRemaining(held)}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * The cancel as a box of its own, beside a single running clock (maintainer, 2026-10-08).
 *
 * The research project asked for it: the X and how long is left to decide, on the right of the bar
 * in a box drawn round them, and when the tenth is gone the box stays and says the project can no
 * longer be called off. A blank where the X used to be reads as a fault; a box that says "too late"
 * reads as a rule. Same size in both states, so the bar beside it never moves.
 */
export function CancelBox({
  windowMs,
  closedText = 'Cannot be cancelled',
  className,
  ...button
}: CancelProps & { closedText?: string }) {
  const { held, lit, live } = useFadingWindow(windowMs);

  return (
    <span
      className={cn(
        'ink-box relative flex h-12 w-[10.5rem] shrink-0 items-center justify-center px-3',
        className,
      )}
      data-testid={`box-${button['data-testid']}`}
      data-open={live ? true : undefined}
    >
      {held !== null && (
        <span
          className="absolute inset-0 flex items-center gap-2.5 px-3 transition-opacity duration-200 ease-out motion-reduce:transition-none"
          style={{ opacity: lit ? 1 : 0 }}
          aria-hidden={live ? undefined : true}
        >
          <CancelButton {...button} pending={button.pending || !live} />
          <span className="flex min-w-0 flex-col leading-none">
            <span
              className="font-display text-[13px] font-bold tabular-nums text-ink-100"
              data-testid={`${button['data-testid']}-window`}
            >
              {formatRemaining(held)}
            </span>
            <span className="mt-1 font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
              left to decide
            </span>
          </span>
        </span>
      )}
      <span
        // Never in the X's way: it is only words, and it sits under the X while the X fades.
        className="pointer-events-none flex items-center gap-1.5 text-center font-display text-[10px] uppercase leading-tight tracking-[0.14em] text-ink-400 transition-opacity duration-200 ease-out motion-reduce:transition-none"
        style={{ opacity: held === null ? 1 : 0 }}
        aria-hidden={held === null ? undefined : true}
        data-testid={`closed-${button['data-testid']}`}
      >
        <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
        {closedText}
      </span>
    </span>
  );
}
