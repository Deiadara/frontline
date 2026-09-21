import { findUnit } from '@frontline/shared';
import type { ReactNode } from 'react';
import { UnitPortrait } from './UnitPortrait';
import { UnitTrigger } from './UnitWindow';
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
 *
 * **Pointing at one opens its card, and pressing it opens the card as a window** (`UnitTrigger`).
 * A chip is drawn for the Combine's units as well as a player's own, and those sheets are on no
 * roster: a Suppressor's fog weakness was the whole counterplay against it and there was no screen
 * in the game that said so. The trigger is the button and the chip inside it is untouched, so the
 * chip looks the same until a pointer reaches it and its `data-testid` stays where every spec
 * expects it.
 *
 * The card is the roster's own (maintainer, 2026-09-20). It used to be a narrow `InfoWindow` with
 * a blurb and a list, so a chip and the roster disagreed about what a unit looks like, and the
 * marks on it could not be pointed at: a hover card is portalled `pointer-events-none`, which is
 * what the press is for.
 */
export function UnitChip({
  unitId,
  count,
  muted = false,
  card,
  label,
  'data-testid': testId,
}: {
  unitId: string;
  count: number;
  /** The ring outside a fight rather than the fight: same shape, quieter. */
  muted?: boolean;
  /**
   * A different card for this chip, where the screen around it knows something the sheet cannot.
   *
   * The battle page is the one caller: a unit standing on a battlefield has *effective* numbers,
   * and `EffectiveCard` runs the engine's own `effectiveStats` against that ground to print them.
   * Passing it here rather than wrapping the chip in a second `HoverCard` is not a nicety: two
   * nested hover cards are two nested `<button>`s, which is invalid, and the keyboard can only
   * ever reach one of them.
   */
  card?: ReactNode;
  /** What the trigger is called for anyone who cannot see it. Defaults to the unit's sheet. */
  label?: string;
  'data-testid'?: string;
}) {
  const unit = findUnit(unitId);
  const chip = (
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

  // An id the catalogue has never heard of has no sheet to open, so it gets no trigger: a button
  // that reveals an empty window is worse than a chip that stays a chip.
  if (!unit) return chip;

  return (
    <UnitTrigger unitId={unitId} label={label} card={card}>
      {chip}
    </UnitTrigger>
  );
}
