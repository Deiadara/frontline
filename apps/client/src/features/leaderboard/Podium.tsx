import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { MedalPlate, Wreath, metalFor } from './ink';

/**
 * The top of the board, given the treatment the top of a board gets.
 *
 * A ranking whose first row looks like its fortieth is a list. The one thing every player opens a
 * leaderboard for is who is winning, and a table answers that with a number in a column.
 *
 * ## Why it is not shown on a short screen
 *
 * The sheet between the two fixed bars is about 440px tall at 720, and a hundred pixels of podium
 * there is two and a half rows of the ranking it is summarising. So the podium is hidden below
 * 820px of viewport, which is the same viewport where the board's other complaint lives: at 1080
 * there was a third of a sheet of blank paper under five rows, and this is what goes in it. A short
 * screen keeps its rows, and the medals in the rank column carry the top three on their own.
 *
 * Drawn rather than hidden, so the sizes agree at every width: `display` is the only thing the
 * media query changes.
 */

export interface Leader {
  /** React's key, and nothing else reads it. */
  key: string;
  rank: number;
  name: string;
  /** The file this card is a door to. */
  href: string;
  /** A faction badge, or whatever else identifies the row at a glance. */
  emblem?: ReactNode;
  /** One line under the name: where they fight, or who sits at the table. */
  note: ReactNode;
  /** The figure the board is ranked on, already rounded by the caller's rules. */
  figure: number;
  /** True for the reader's own row, which is marked here as well as in the table. */
  you?: boolean;
}

/**
 * Where each place sits on screen, and how proud it stands.
 *
 * Second, first, third, which is what a podium looks like and what a player expects to read. DOM
 * order stays 1, 2, 3 (a screen reader and the keyboard get the ranking in its own order) and
 * `order` does the moving.
 */
const PLACE = [
  { order: 'order-2', lift: 'py-3', wreath: 'h-[4.75rem] w-[4.75rem]', name: 'text-[17px]' },
  { order: 'order-1', lift: 'py-2', wreath: 'h-[4.05rem] w-[4.05rem]', name: 'text-[15px]' },
  { order: 'order-3', lift: 'py-2', wreath: 'h-[4.05rem] w-[4.05rem]', name: 'text-[15px]' },
] as const;

function PodiumCard({ leader, at }: { leader: Leader; at: number }) {
  const metal = metalFor(leader.rank) ?? 'bronze';
  const place = PLACE[at] ?? PLACE[2];
  if (!place) return null;
  return (
    <Link
      to={leader.href}
      data-testid={`podium-${leader.name}`}
      data-place={leader.rank}
      className={cn(
        'card-paper washed edge-lit group flex min-w-0 items-center justify-center gap-3 rounded-sm border px-2.5 transition-colors',
        place.order,
        place.lift,
        // The winner's card carries the brass edge. Everything else on this screen that is worth
        // acting on is brass, so the one card that is the answer to the question gets it too.
        leader.rank === 1
          ? 'border-brass-500/60 hover:border-brass-300'
          : 'border-surface-600/70 hover:border-brass-500/60',
      )}
    >
      <Wreath metal={metal} className={cn('shrink-0', place.wreath)}>
        <MedalPlate
          metal={metal}
          className="h-[46%] w-[46%] font-display text-[15px] font-bold leading-none tabular-nums"
        >
          {leader.rank}
        </MedalPlate>
      </Wreath>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'truncate font-stamp leading-tight text-ink-100 group-hover:text-brass-100',
            place.name,
          )}
        >
          {leader.name}
          {leader.you === true && (
            <span className="ml-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
              you
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-body text-[11px] leading-tight text-ink-400">
          {leader.emblem}
          <span className="truncate">{leader.note}</span>
        </span>
        {/* The figure with the glyph rather than a word under it. The column heading two inches
            below already names which of the two figures the board is ranked on, and repeating the
            word here is the same label twice on one frame. */}
        <span className="flex items-center gap-1.5 font-display text-[17px] font-bold leading-none tabular-nums text-brass-300">
          <Icon name="infamy" aria-hidden className="h-3.5 w-3.5 text-brass-500" />
          {leader.figure.toLocaleString()}
        </span>
      </span>
    </Link>
  );
}

export function Podium({ leaders }: { leaders: readonly Leader[] }) {
  if (leaders.length < 3) return null;
  return (
    <div
      data-testid="standings-podium"
      // `items-end`, so the taller first card stands on the same floor as the other two rather
      // than being centred against them.
      // Held to a measure rather than run to the sheet's full width: three cards 500px wide
      // holding 250px of content read as three bars, and the ranking under them is what the width
      // is for.
      className="mx-auto grid w-full max-w-[66rem] shrink-0 grid-cols-3 items-end gap-2.5 p-3 [@media(max-height:819px)]:hidden"
    >
      {leaders.slice(0, 3).map((leader, at) => (
        <PodiumCard key={leader.key} leader={leader} at={at} />
      ))}
    </div>
  );
}
