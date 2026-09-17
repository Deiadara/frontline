import type { ReactNode } from 'react';
import { PageShell } from '../game/PageShell';
import { CloseMark } from './marks';
import { cn } from '../../lib/cn';

/**
 * The frame the two standing ladders share.
 *
 * `PageShell` already owns everything a screen needs to sit under the chrome: the district blurred
 * back into scenery, the measured insets for the standing bar and the scenery switcher, and the
 * scroll inside the sheet rather than on the page. What these two add is the way out, drawn, pinned
 * to the top right of the header, which is where the maintainer asked for it.
 *
 * Both screens keep a **title**, and that is `PageShell`'s own rule rather than a choice: a screen
 * with no door in the switcher has nothing else carrying its name. These two are reached from a
 * chip in the standing bar and from nowhere else.
 */
export function StandingSheet({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <PageShell title={title} lede={lede} action={<CloseMark />}>
      {children}
    </PageShell>
  );
}

/**
 * A sheet of paper inside the sheet, in the feats board's material.
 *
 * `ink-frame card-paper washed grain` is the exact stack the feats summary box carries, and the
 * order matters: `.card-paper` declares its ground as a longhand `background-color` after its own
 * shorthand precisely so that `.grain` setting a `background-image` cannot leave the panel
 * transparent. See the note over `.card-paper` in `index.css`.
 */
export function PaperBlock({
  className,
  children,
  'data-testid': testId,
}: {
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cn(
        'ink-frame card-paper washed grain relative rounded-sm px-4 py-3.5 shadow-panel',
        className,
      )}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
