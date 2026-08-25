import { findUnit } from '@frontline/shared';
import { UnitPortrait } from './UnitPortrait';
import { cn } from '../../lib/cn';

/**
 * One kind of unit and how many of them: the picture, the name, the number.
 *
 * Anywhere a force is listed. It replaced a generic outlined figure repeated down a column, which
 * told a player nothing they did not already know from the word beside it: the roster has painted
 * art for most of the catalogue and this is the one place it was not being used.
 *
 * Stacked rather than in a row, because a row of `[icon] NAME 12` sets the picture at the height of
 * the type and a portrait at 16px is a smudge. The icon is a square above, the name and the count a
 * line under it, and the whole chip is a fixed width so a force of nine kinds lays out as a grid
 * rather than as ragged text.
 */
export function UnitChip({
  unitId,
  count,
  muted = false,
  'data-testid': testId,
}: {
  unitId: string;
  count: number;
  /** The ring outside a fight rather than the fight: same shape, quieter. */
  muted?: boolean;
  'data-testid'?: string;
}) {
  const unit = findUnit(unitId);
  return (
    <span
      data-testid={testId}
      className={cn(
        'card-paper edge-lit flex w-[5.5rem] shrink-0 flex-col items-center gap-1 rounded-sm border p-1.5',
        muted ? 'border-surface-700' : 'border-surface-600/80',
      )}
    >
      <UnitPortrait
        unitId={unitId}
        tier={unit?.tier ?? 'rabble'}
        className={cn('w-full rounded-sm border border-surface-700', muted && 'opacity-70')}
      />
      <span className="w-full truncate text-center font-display text-[10px] uppercase leading-none tracking-[0.06em] text-ink-300">
        {unit?.name ?? unitId}
      </span>
      <span
        className={cn(
          'font-display text-[15px] font-bold leading-none tabular-nums',
          muted ? 'text-ink-200' : 'text-ink-100',
        )}
      >
        {count}
      </span>
    </span>
  );
}
