import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A framed, labelled region inside a `Panel`.
 *
 * Panels on the battle board had grown into stacks of loose rows: a heading, then some text, then
 * a control, then more text, with nothing but vertical gaps saying which control belonged to which
 * reading. Gap alone is the weakest grouping signal there is, and it fails first on the screens
 * that need it most, which are the dense ones.
 *
 * So a panel is a container of *sections*, and a section is a box with a name and, when it has
 * one, its own action pinned to that name. The frame is what makes "this button does that thing"
 * a fact about the layout rather than something the player infers from proximity.
 *
 * A step **darker** than the panel it sits in, where the panel is a step lighter than the sheet.
 * Value does the nesting; the hairline only finishes the edge. See the note on `Panel` for why the
 * border is not asked to do the grouping on its own.
 */
export function PanelSection({
  label,
  action,
  note,
  children,
  className,
  ...rest
}: {
  label: ReactNode;
  /** Pinned to the right of the label: the one control the section is *for*. */
  action?: ReactNode;
  /** A quiet line under the label, for the rule the section runs on. */
  note?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-sm border border-surface-700 bg-surface-950/40',
        className,
      )}
      {...rest}
    >
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-surface-700/80 px-2.5 py-1.5">
        <span className="min-w-0">
          <span className="block truncate font-display text-[11px] font-bold uppercase tracking-[0.2em] text-brass-300">
            {label}
          </span>
          {note !== undefined && (
            <span className="mt-0.5 block truncate font-body text-[11px] leading-tight text-ink-300">
              {note}
            </span>
          )}
        </span>
        {action !== undefined && <span className="shrink-0">{action}</span>}
      </header>
      <div className="min-w-0 p-2.5">{children}</div>
    </section>
  );
}
