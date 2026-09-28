import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { DrawnFace, DrawnGlyph } from './DrawnMarks';

/**
 * A refusal, written on the sheet in red and boxed by hand (maintainer, 2026-09-25).
 *
 * Every error in the game used to be a bare line of red sans floating over whatever it belonged
 * to, and seventy of them had drifted into seventy slightly different sizes. This is the one
 * drawing they all use: the same inked box the drawn buttons wear (`DrawnFace`), in oxblood, with
 * the warning mark put through the pen and the words struck in the typewriter face the game keeps
 * for things a player reads one line at a time.
 *
 * `role="alert"` lives here and nowhere else. It is what a screen reader announces, and it is also
 * what `lib/sound.ts` listens for to play the refusal, so a call site cannot drop it by accident.
 *
 * Sized to its words (`w-fit`) rather than to its row: a short refusal in a wide panel is a note
 * pinned to the sheet, not a banner across it. A call site that wants it to take the rest of a
 * row, beside a pair of buttons, says so with `flex-1`.
 *
 * `backdrop` is for the few that float over a painting rather than sit on a sheet: the city's
 * order toasts and the district sign. A fifteen-per-cent wash is paper on paper and nothing over
 * art, so those take a near-opaque face instead.
 */
export function ErrorNote({
  children,
  className,
  backdrop = false,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode; backdrop?: boolean }) {
  // An empty refusal is one with nothing to say: the player declined the waste warning
  // (`WASTE_DECLINED` in `lib/api.ts`), and every screen renders `error.message` through here.
  if (children === '') return null;
  return (
    <div
      role="alert"
      className={cn(
        'relative flex w-fit min-w-0 max-w-full items-start gap-2 px-3 py-2 text-oxblood-300',
        className,
      )}
      {...rest}
    >
      <DrawnFace face={backdrop ? 'fill-surface-950/90' : 'fill-oxblood-500/15'} />
      <DrawnGlyph name="alert" className="relative mt-px h-3.5 w-3.5 shrink-0" />
      <span className="relative min-w-0 break-words font-stamp text-[12px] leading-snug">
        {children}
      </span>
    </div>
  );
}
