import { cn } from '../../lib/cn';

/**
 * A clock, drawn.
 *
 * Ten screens in this game had a running thing on them: a build, a batch on the bench, a project, a
 * mission in flight, a drill, and every one of them drew its own bar out of two spans and a
 * hard-coded height. Ten copies of the same widget, three different track colours, and two of them
 * with no remaining time on the bar at all, which is the one number a player actually wants: not
 * *how far in*, but *how long left*.
 *
 * This is the one bar. It is painted rather than plotted: a groove in the panel with a loaded
 * brush stroke in it, a ragged leading edge, and the time in the hand face where the stroke ends,
 * because a flat rounded pill filling up left to right is the single most "framework" object an
 * interface can contain, and this game is meant to look like somebody made it.
 *
 * It is also the only progress indicator in the client that announces itself: `role="progressbar"`
 * with the real bounds, so a screen reader is told a percentage rather than being read an empty
 * `<span>`.
 */

export type ProgressTone = 'brass' | 'iris' | 'verdigris' | 'oxblood';

/** Pigment per tone. The stroke's own colour; `paint-fill` supplies the bristle shading. */
const PIGMENT: Record<ProgressTone, string> = {
  brass: 'bg-brass-300',
  iris: 'bg-iris-300',
  verdigris: 'bg-verdigris-300',
  oxblood: 'bg-oxblood-300',
};

const TICK: Record<ProgressTone, string> = {
  brass: 'text-brass-100',
  iris: 'text-iris-100',
  verdigris: 'text-verdigris-100',
  oxblood: 'text-oxblood-100',
};

export interface ProgressBarProps {
  /** How far through, `0`..`1`. Clamped rather than trusted: a stale clock can overshoot. */
  progress: number;
  /**
   * What is running, in a word or two. Read out with the percentage, so it must name the *thing*
   * rather than describe the bar: "Greenhouse to 3", not "progress".
   */
  label: string;
  /** How long is left, already formatted. Drawn at the end of the stroke. */
  remaining?: string;
  tone?: ProgressTone;
  /** Taller, for a bar that is the subject of its panel rather than a line in a list. */
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

export function ProgressBar({
  progress,
  label,
  remaining,
  tone = 'brass',
  size = 'sm',
  className,
  'data-testid': testId,
}: ProgressBarProps) {
  const share = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const percent = Math.round(share * 100);

  return (
    <span className={cn('block min-w-0', className)} data-testid={testId}>
      {remaining !== undefined && (
        <span className="mb-1 flex min-w-0 items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {label}
          </span>
          {/* The number a player is actually waiting on, in the hand face and given the room to be
              read as a phrase rather than as a field.
              
              `tabular-nums` because most of what goes here is counting down. In a proportional
              face `1` is narrower than `0`, so `2m 10s` is a different width from `2m 09s` and the
              text shuffles left and right once a second for the whole of a build. It costs nothing
              on the ones that are words: the class only governs digits. */}
          <span
            className={cn('shrink-0 font-stamp text-[13px] leading-none tabular-nums', TICK[tone])}
          >
            {remaining}
          </span>
        </span>
      )}
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={cn('paint-track block w-full rounded-[2px]', size === 'md' ? 'h-3' : 'h-2')}
      >
        <span
          className={cn('paint-fill block h-full', PIGMENT[tone])}
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}
