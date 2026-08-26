import { FORTIFY_MAX_LEVEL } from '@frontline/shared';
import { cn } from '../../lib/cn';

/**
 * How far a position is dug in, drawn rather than spelled (§A4).
 *
 * The level used to be printed as `2 / 5`, which is a number a player has to read and convert.
 * Fortification is the one stat on a location card that is *about* a physical thing, so it is
 * drawn as that thing: three courses of an embankment stacked front to back, filled from the
 * ground up. A glance at the shape answers "how dug in is this" without reading anything, and the
 * percentage still sits beside it for the player who wants the number.
 *
 * The courses widen as they go down because that is how an earthwork is actually built, and
 * because it makes level 3 read as *heavier* rather than merely as one more tick: the top course
 * is the expensive one and it should look like the expensive one.
 *
 * Empty courses are drawn, not omitted. A meter that hid what you had not bought would make an
 * undug location and a fully dug one the same silhouette at a glance, which is the one comparison
 * this graphic exists to make.
 */

/** Front-to-back courses: the widest sits at the front, and each is `[x, width]` in viewBox units. */
const COURSES: readonly { x: number; width: number; y: number }[] = [
  { x: 1.5, width: 29, y: 15.5 },
  { x: 5, width: 22, y: 9.5 },
  { x: 8.5, width: 15, y: 3.5 },
];

export function FortifyMeter({
  level,
  percent,
  className,
  size = 'md',
}: {
  level: number;
  /** The defence it is worth, printed beside the graphic. Omitted renders the bank alone. */
  percent?: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const dug = Math.max(0, Math.min(FORTIFY_MAX_LEVEL, Math.trunc(level)));
  const label =
    dug === 0
      ? 'Not dug in'
      : `Dug in to level ${dug} of ${FORTIFY_MAX_LEVEL}${percent === undefined ? '' : `, worth ${percent}% defence`}`;

  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-tip={label}>
      <svg
        viewBox="0 0 32 22"
        role="img"
        aria-label={label}
        // `sm` is sized to sit inside a district card's stat rows without making them taller
        // than the text rows either side of it; `md` is the standalone readout on the Gate panel,
        // where it is the thing being looked at.
        className={cn('shrink-0', size === 'sm' ? 'h-4 w-6' : 'h-7 w-11')}
        data-testid="fortify-meter"
        data-level={dug}
      >
        {COURSES.map((course, index) => {
          const earned = index < dug;
          return (
            <rect
              key={course.y}
              x={course.x}
              y={course.y}
              width={course.width}
              height={5}
              rx={1.5}
              className={cn(
                'transition-colors duration-200',
                earned ? 'fill-brass-300 stroke-brass-500' : 'fill-surface-900 stroke-surface-600',
              )}
              strokeWidth={1}
            />
          );
        })}
      </svg>
      {percent !== undefined && (
        <span
          className={cn(
            'font-display tabular-nums leading-none',
            size === 'sm' ? 'text-[11px]' : 'text-[12px]',
            dug === 0 ? 'text-ink-300' : 'text-brass-300',
          )}
        >
          +{percent}%
        </span>
      )}
    </span>
  );
}
