import {
  MAX_FACTION_MEMBERS,
  notorietyTier,
  type FactionStanding,
  type PlayerStanding,
} from '@frontline/shared';
import type { ReactNode, RefObject } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { crewFileHref } from '../city/LocationSheet';
import { FactionBadge } from '../faction/FactionBadge';
import { factionProfileHref } from '../faction/FactionProfilePage';
import type { Leader } from './Podium';
import { LedgerFill, MedalPlate, RULED_ROW, SeatTicks, YouMark, metalFor } from './ink';
import type { PlayerSort } from './players';

/**
 * The two ranked sheets.
 *
 * They are separate components because they rank different things, and the maintainer's note was that
 * they had been reading as one table wearing two sets of headings. A crew is a person with a
 * district, a level and a street name; a faction is a badge with seats at a table. So the identity
 * cell differs, the columns differ, and the head is inked in a different colour: brass for the
 * people, verdigris for the tables, which is the same pair `.ink-box` and `.ink-box-verdigris` use
 * to say "same pen, different ink".
 *
 * ## Five kinds of thing, five weights
 *
 * The rank is a struck medal or a quiet numeral, the name is set in the hand face, the faction is a
 * badge and a door drawn at half the name's weight, the level is a small plate, and the figure the
 * board is ranked on is the loudest thing in the row. They were five columns of identical type,
 * which is what made the screen read as a spreadsheet.
 */

/** The columns, in one place, so a heading and the cells under it cannot drift apart. */
const COL = {
  rank: 'w-10 shrink-0',
  faction: 'w-44 shrink-0',
  level: 'w-16 shrink-0',
  small: 'w-14 shrink-0',
  figure: 'w-28 shrink-0',
};

type Ink = 'brass' | 'verdigris';

const HEAD_INK: Record<Ink, string> = {
  brass: 'border-brass-500/30',
  verdigris: 'border-verdigris-300/30',
};

function Head({ ink, children }: { ink: Ink; children: ReactNode }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b bg-surface-900/95 px-4 py-1',
        'font-display text-[10px] uppercase tracking-[0.18em] text-ink-400',
        HEAD_INK[ink],
      )}
    >
      {children}
    </div>
  );
}

/**
 * The rank plate.
 *
 * The top three are struck in metal and everybody else gets the numeral on its own. By rank rather
 * than by row, so a shared third place is two bronzes: the board hands out places, not positions.
 */
function Rank({ rank }: { rank: number }) {
  const metal = metalFor(rank);
  const type = 'font-display text-[14px] font-bold leading-none tabular-nums';
  if (metal === null) {
    return <span className={cn(COL.rank, type, 'text-center text-ink-400')}>{rank}</span>;
  }
  return (
    <MedalPlate metal={metal} className={cn(COL.rank, 'h-9', type)}>
      {rank}
    </MedalPlate>
  );
}

/** The level, as a stamped plate rather than as another number in another column. */
function Level({ value }: { value: number }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-[2.25rem] items-center justify-center rounded-[2px] border border-surface-500/70',
        'bg-surface-800/70 px-1.5 py-0.5 font-display text-[12px] font-bold tabular-nums text-ink-200',
      )}
    >
      {value}
    </span>
  );
}

/** The figure the board is ranked on: the loudest thing in the row, and the last. */
function Figure({ value, testId }: { value: number; testId?: string }) {
  return (
    <span
      className={cn(
        COL.figure,
        'text-right font-display text-[15px] font-bold tabular-nums text-brass-300',
      )}
      data-testid={testId}
    >
      {Math.round(value).toLocaleString()}
    </span>
  );
}

/**
 * The faction cell, badge slot and all.
 *
 * The slot is kept whether or not there is a badge in it. Drawn only for the crews that have one,
 * the column had two left edges and four rows read as two ragged lists side by side.
 */
function AtTheTable({ entry }: { entry: PlayerStanding }) {
  return (
    <span className={cn(COL.faction, 'hidden items-center gap-2 sm:flex')}>
      <span className="flex h-[27px] w-[22px] shrink-0 items-center">
        {entry.factionBadge && <FactionBadge badge={entry.factionBadge} size={22} />}
      </span>
      {/* A door to the table, not a caption. A row with no faction id has nowhere to go and stays
          as plain text. */}
      {entry.factionName !== null && entry.factionId !== null ? (
        <Link
          to={factionProfileHref(entry.factionId)}
          data-testid={`standing-faction-${entry.username}`}
          className="truncate font-body text-[12px] text-brass-300 underline-offset-2 hover:underline"
        >
          {entry.factionName}
        </Link>
      ) : (
        <span className="truncate font-body text-[12px] text-ink-500">none</span>
      )}
    </span>
  );
}

/**
 * The last column follows the sort, because a board ranked on a number it does not show reads as
 * broken (maintainer request, 2026-09-12).
 *
 * Sorting by total infamy put a crew holding 1,200 above one holding 9,840 and printed both
 * wallets, so the only thing on screen said the order was wrong. It was not: the crew on top had
 * been paid 37,500 and spent most of it on the ladder. The figure the board is sorted on is the
 * figure the board prints.
 */
export const playerFigure = (entry: PlayerStanding, sort: PlayerSort): number =>
  sort === 'total' ? entry.totalInfamy : entry.infamy;

export function PlayerBoard({
  entries,
  youUserId,
  youRow,
  focus,
  focusRow,
  sort,
}: {
  entries: readonly PlayerStanding[];
  youUserId: string;
  /** Hung on the reader's own row so the plaque at the foot of the page can scroll to it. */
  youRow: RefObject<HTMLLIElement>;
  /** The username the standings were opened on, from `?focus=`, if any. */
  focus: string | undefined;
  /** The row that username landed on, so the page can scroll it into view. */
  focusRow: RefObject<HTMLLIElement>;
  sort: PlayerSort;
}) {
  return (
    <>
      <Head ink="brass">
        <span className={cn(COL.rank, 'text-center')}>#</span>
        <span className="min-w-0 flex-1">Name</span>
        <span className={cn(COL.faction, 'hidden sm:block')}>Faction</span>
        <span className={cn(COL.level, 'text-right')}>Level</span>
        <span className={cn(COL.figure, 'text-right')}>
          {sort === 'total' ? 'Total' : 'Infamy'}
        </span>
      </Head>
      <ul className="shrink-0">
        {entries.map((entry) => {
          const you = entry.userId === youUserId;
          // The crew the search sent the reader here to look at. Marked so the eye lands on it
          // after the scroll: a page jumping to the middle of a hundred identical rows with
          // nothing picked out is a page that has not answered the question.
          const sought = focus !== undefined && entry.username === focus;
          return (
            <li
              key={entry.userId}
              ref={sought ? focusRow : you ? youRow : undefined}
              data-testid={`standing-${entry.username}`}
              data-you={you ? 'true' : undefined}
              data-sought={sought ? 'true' : undefined}
              className={cn(
                'relative flex items-center gap-3 px-4',
                you && 'bg-brass-300/[0.12]',
                sought && 'bg-iris-300/[0.16] ring-1 ring-inset ring-iris-300/40',
              )}
              style={RULED_ROW}
            >
              {/* First, and holding nothing but the number: the ranking gates read this cell's
                  text to prove a tie shares its place. The reader's own mark is drawn after it and
                  positioned out of the flow. */}
              <Rank rank={entry.rank} />
              {you && <YouMark />}

              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-baseline gap-1.5 font-stamp text-[15px] leading-tight text-ink-100">
                  {/* The name is a door to the crew's file, by the player's id: the file answers
                      to that as well as to the crew's. */}
                  <Link
                    to={crewFileHref(entry.userId)}
                    data-testid={`standing-link-${entry.username}`}
                    className="truncate underline-offset-2 hover:text-brass-100 hover:underline"
                  >
                    {entry.username}
                  </Link>
                  {you && <span className="shrink-0 text-[11px] text-brass-300">you</span>}
                  {entry.isBot && <span className="shrink-0 text-[11px] text-ink-500">house</span>}
                </span>
                {/* Where they hold, and what the street calls them. The tier was already on the
                    wire and the screen was dropping it, which left the row saying nothing about
                    the person it is a door to. */}
                <span className="flex min-w-0 items-center gap-1.5 font-body text-[11px] leading-tight text-ink-400">
                  <span className="truncate">{entry.districtName}</span>
                  <span aria-hidden className="shrink-0 text-brass-500/70">
                    &middot;
                  </span>
                  <span className="shrink-0 font-display uppercase tracking-[0.12em] text-brass-500">
                    {notorietyTier(entry.notoriety)}
                  </span>
                </span>
              </span>

              <AtTheTable entry={entry} />
              <span className={cn(COL.level, 'flex justify-end')}>
                <Level value={entry.level} />
              </span>
              <Figure
                value={playerFigure(entry, sort)}
                testId={`standing-figure-${entry.username}`}
              />
            </li>
          );
        })}
      </ul>
      <LedgerFill />
    </>
  );
}

export function FactionBoard({ entries }: { entries: readonly FactionStanding[] }) {
  return (
    <>
      <Head ink="verdigris">
        <span className={cn(COL.rank, 'text-center')}>#</span>
        <span className="min-w-0 flex-1">Faction</span>
        <span className={cn(COL.small, 'text-right')}>Avg</span>
        <span className={cn(COL.small, 'text-right')}>Top</span>
        <span className={cn(COL.figure, 'text-right')}>Earned</span>
      </Head>
      <ul className="shrink-0">
        {entries.map((entry) => (
          <li
            key={entry.factionId}
            data-testid={`standing-${entry.name}`}
            className="relative flex items-center gap-3 px-4"
            style={RULED_ROW}
          >
            <Rank rank={entry.rank} />
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <FactionBadge badge={entry.badge} size={28} />
              <span className="flex min-w-0 flex-col">
                {/* A faction row is a door to that faction's file, the same way a crew row is a
                    door to a crew's. It was the one row on this screen that led nowhere. */}
                <Link
                  to={factionProfileHref(entry.factionId)}
                  data-testid={`standing-link-${entry.name}`}
                  className="truncate font-stamp text-[15px] leading-tight text-ink-100 underline-offset-2 hover:text-brass-100 hover:underline"
                >
                  {entry.name}
                </Link>
                <span className="flex items-center gap-1.5 font-body text-[11px] leading-tight text-ink-400">
                  <SeatTicks taken={entry.members} of={MAX_FACTION_MEMBERS} />
                  <span className="truncate">
                    {entry.members} of {MAX_FACTION_MEMBERS} seats
                  </span>
                </span>
              </span>
            </span>
            {/* The mean level of the table, which the server has always sent and the board never
                drew. `Top` says how good the best of them is; a faction of one answers that with
                the same number as a faction of five. */}
            <span
              className={cn(
                COL.small,
                'text-right font-display text-[13px] tabular-nums text-ink-200',
              )}
            >
              {entry.averageLevel}
            </span>
            <span
              className={cn(
                COL.small,
                'text-right font-display text-[13px] tabular-nums text-ink-200',
              )}
            >
              {entry.topLevel}
            </span>
            <Figure value={entry.infamy} />
          </li>
        ))}
      </ul>
      <LedgerFill />
    </>
  );
}

/** The top of the players' board, in the shape the podium reads. */
export function playerLeaders(
  entries: readonly PlayerStanding[],
  sort: PlayerSort,
  youUserId: string,
): Leader[] {
  return entries.slice(0, 3).map((entry) => ({
    key: entry.userId,
    rank: entry.rank,
    name: entry.username,
    href: crewFileHref(entry.userId),
    emblem: entry.factionBadge ? <FactionBadge badge={entry.factionBadge} size={16} /> : undefined,
    note: entry.factionName ?? entry.districtName,
    figure: Math.round(playerFigure(entry, sort)),
    you: entry.userId === youUserId,
  }));
}

/** And the top of the factions' board. */
export function factionLeaders(entries: readonly FactionStanding[]): Leader[] {
  return entries.slice(0, 3).map((entry) => ({
    key: entry.factionId,
    rank: entry.rank,
    name: entry.name,
    href: factionProfileHref(entry.factionId),
    emblem: <FactionBadge badge={entry.badge} size={16} />,
    note: `${entry.members} of ${MAX_FACTION_MEMBERS} seats`,
    figure: Math.round(entry.infamy),
  }));
}
