import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/ui/Icon';

/**
 * A section of a file: a plated mark, a name, a drawn rule, and what is under it.
 *
 * Shared by your own file (`OverseerProfilePage`) and by every crew's public one
 * (`CrewProfilePage`), so the two read as pages of the same dossier.
 */
export function FileSection({
  icon,
  title,
  note,
  action,
  children,
}: {
  icon: IconName;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    // A drawn sheet rather than a heading over loose content: the file now holds one section, and
    // a bare rule with a grid under it read as the page having failed to finish loading. Same
    // frame the faction, standings and training screens use.
    <section className="ink-frame card-paper washed flex min-w-0 flex-col gap-2.5 p-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
          >
            <Icon name={icon} />
          </span>
          <h2 className="min-w-0 flex-1 font-stamp text-[17px] leading-tight text-ink-100">
            {title}
          </h2>
          {action}
        </div>
        <span aria-hidden className="ink-rule block w-full" />
        {note !== undefined && (
          <p className="font-body text-[12px] leading-snug text-ink-300">{note}</p>
        )}
      </header>
      {children}
    </section>
  );
}
