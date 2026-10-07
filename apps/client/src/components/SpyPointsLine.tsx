import type { SpyPoints } from '@frontline/shared';
import { cn } from '../lib/cn';

/**
 * The crew's own spy strength both ways (maintainer, 2026-10-07): what its runners carry out, and
 * what a rival's must beat. One line, drawn the same on the Master of Whispers' chair, the Spy
 * Reports tab and the district reports, so the three never disagree about the number.
 */
export function SpyPointsLine({
  points,
  label = 'Spying',
  className,
}: {
  points: SpyPoints;
  label?: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300',
        className,
      )}
      data-testid="spy-points"
    >
      <span>{label}</span>
      <span>
        Offence{' '}
        <span className="tabular-nums text-brass-100" data-testid="spy-points-offence">
          {points.offence}
        </span>
      </span>
      <span>
        Defence{' '}
        <span className="tabular-nums text-brass-100" data-testid="spy-points-defence">
          {points.defence}
        </span>
      </span>
    </p>
  );
}
