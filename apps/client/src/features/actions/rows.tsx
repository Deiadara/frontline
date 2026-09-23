import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { IconName } from '../../components/ui/Icon';
import { FileSection } from '../overseer/FileSection';

/**
 * The two shapes every Monitor list is made of: a drawn section with a count on it, and one row in
 * it with a name and a state plate. Shared by the road and the In progress page, so a build being
 * worked at home and a column walking to a fight are visibly the same kind of entry.
 */
export function Section({
  icon,
  title,
  note,
  count,
  children,
}: {
  icon: IconName;
  title: string;
  /** One line under the heading. Optional: Spying carries none, at the maintainer's request. */
  note?: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <FileSection
      icon={icon}
      title={title}
      // Spread rather than passed, because `exactOptionalPropertyTypes` treats an explicit
      // `undefined` as a value and `FileSection` declares the prop as absent-or-string.
      {...(note === undefined ? {} : { note })}
      action={
        <span className="rounded-sm border border-brass-500/50 bg-brass-300/10 px-2 py-0.5 font-display text-[11px] font-bold tabular-nums tracking-[0.12em] text-brass-100">
          {count}
        </span>
      }
    >
      {children}
    </FileSection>
  );
}

export function Row({
  testId,
  name,
  heading,
  status,
  tone = 'plain',
  children,
}: {
  testId: string;
  name: string;
  /** Drawn in place of the bare name when the name is a door to something, such as a job's card. */
  heading?: ReactNode;
  status: string;
  tone?: 'plain' | 'hot' | 'done';
  children: ReactNode;
}) {
  return (
    <li
      data-testid={testId}
      className="flex flex-col gap-2.5 rounded-sm border border-surface-700 bg-surface-950/40 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-stamp text-[16px] leading-tight text-ink-100">
          {heading ?? name}
        </h3>
        <span
          className={cn(
            'shrink-0 rounded-sm border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
            tone === 'hot'
              ? 'border-oxblood-500/60 text-oxblood-300'
              : tone === 'done'
                ? 'border-verdigris-300/60 text-verdigris-100'
                : 'border-surface-600 text-ink-300',
          )}
        >
          {status}
        </span>
      </div>
      {children}
    </li>
  );
}
