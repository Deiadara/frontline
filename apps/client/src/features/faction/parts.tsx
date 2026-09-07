import { findUnit, type Army } from '@frontline/shared';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';

/**
 * The small drawn pieces this screen is built out of.
 *
 * Here rather than repeated per panel: the windows, the fight cards and the column all want the
 * same little figure chip, the same list of unit tags and the same window header, and three copies
 * of a header is how one of them ends up a different size from the other two.
 */

/** A heading inside a window: the same lettering as a band, one step down, with its rule. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {children}
      </h3>
      <span aria-hidden className="ink-rule h-1 w-full" />
    </div>
  );
}

/** One number about one person: a glyph and the figure, small enough to sit three to a card. */
export function Figure({
  icon,
  value,
  title,
}: {
  icon: IconName;
  value: string;
  /** What the number is, for a pointer and for a screen reader. */
  title: string;
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-1 rounded-sm border border-surface-600/80 bg-surface-950/50 px-1.5 py-0.5"
      title={title}
    >
      <Icon name={icon} aria-hidden className="h-3 w-3 shrink-0 text-brass-300" />
      <span className="truncate font-display text-[12px] font-bold tabular-nums text-ink-100">
        {value}
      </span>
    </span>
  );
}

/**
 * A door onto one of the windows this screen keeps its detail behind.
 *
 * The same struck plate the scenery switcher and the standing bar are made of, so a control that
 * opens a screen looks like every other control in the game that opens a screen.
 */
export function Door({
  icon,
  label,
  testId,
  onClick,
}: {
  icon: IconName;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'door-tile flex h-[3.75rem] w-[4.25rem] flex-col items-center justify-center gap-1 rounded-sm',
        'text-ink-200 transition-colors hover:text-brass-100',
      )}
    >
      <Icon name={icon} aria-hidden className="h-5 w-5 shrink-0 text-brass-300" />
      <span className="px-1 text-center font-display text-[9px] font-bold uppercase leading-tight tracking-[0.1em]">
        {label}
      </span>
    </button>
  );
}

/** What somebody can field, as tags. The same drawing wherever an army is listed. */
export function ArmyTags({ army }: { army: Army }) {
  const held = Object.entries(army).filter(([, count]) => count > 0);
  if (held.length === 0) {
    return (
      <span className="font-body text-[12px] italic text-ink-400">Nothing on the roster.</span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {held.map(([unitId, count]) => (
        <span
          key={unitId}
          className="rounded-sm border border-surface-600 bg-surface-950/40 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-200"
        >
          {findUnit(unitId)?.name ?? unitId}{' '}
          <span className="tabular-nums text-brass-300">{count}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A band with nothing in it, drawn rather than left blank.
 *
 * An empty region with one grey sentence in it reads as a screen that failed to load, which is the
 * bug `LoadFailure` exists for at the page level and the same mistake one band down.
 */
export function EmptyPlate({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="card-paper washed flex items-center gap-3 rounded-sm border border-dashed border-surface-600/70 px-4 py-5">
      <span
        aria-hidden
        className="icon-plate flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-ink-400"
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="font-body text-[13px] italic leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

/**
 * Leaving a hover trigger that has just opened a window.
 *
 * A `HoverCard` closes on mouse-leave and on blur. Pressing one that opens a modal fires neither:
 * the window covers the trigger, so the pointer never crosses its edge, and the trigger keeps
 * focus. The card then hangs over the window it just opened, which is exactly what a screenshot of
 * a member's file showed, with the tooltip sitting across the buttons. Dropping focus fires the
 * card's own close, and the window that is opening is the thing that should hold focus anyway.
 */
export function releaseHover(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** A window's own header: its name, and the one control that shuts it. */
export function WindowHead({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose: () => void;
  /** Anything that belongs beside the name: a badge, a count. */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-surface-700/70 px-5 py-3.5">
      {children}
      <h2 id={id} className="min-w-0 flex-1 truncate font-stamp text-[19px] text-ink-100">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-surface-600',
          'text-ink-300 transition-colors hover:border-brass-300/60 hover:text-brass-100',
        )}
      >
        <Icon name="close" aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}
