import {
  LEADERBOARD_BOARDS,
  LEADERBOARD_BOARD_LABELS,
  findCity,
  type FactionStanding,
  type LeaderboardBoard,
  type LeaderboardResponse,
  type PlayerStanding,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { useLeaderboard, useMe } from '../../lib/queries';
import { FactionBadge } from '../faction/FactionBadge';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { PageShell } from '../game/PageShell';

/**
 * The standings (board request, §J9).
 *
 * The shape every game's ranking screen has, because players arrive already knowing it: a row of
 * board tabs, a scope control, a numbered table, and your own place called out whether or not you
 * are on the page. Drawn in this game's register rather than in a spreadsheet's: the table is a
 * ruled sheet, the tabs are drawn tabs, and the rank column is a number in the stamp face.
 *
 * ## Two boards, not one list with a filter
 *
 * A player has a district and a level; a faction has a badge and a seat count. The columns differ,
 * so the tables differ, and the discriminated union on the wire means the faction table cannot be
 * handed a player row.
 *
 * ## What "local" means here
 *
 * The player's **city**. There is one today, so the two scopes list the same people; the board is
 * adding more, and writing the filter against a city id now means that day needs no screen change.
 */
export function LeaderboardPage() {
  const [board, setBoard] = useState<LeaderboardBoard>('players');
  const [localOnly, setLocalOnly] = useState(false);
  const query = useLeaderboard(board, localOnly);
  const me = useMe();
  const data = query.data;

  const cityName = data?.scope ? (findCity(data.scope)?.name ?? data.scope) : null;

  return (
    <PageShell title="Standings" fills wide>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" role="tablist" aria-label="Which standings">
            {LEADERBOARD_BOARDS.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={board === entry}
                data-testid={`board-${entry}`}
                onClick={() => setBoard(entry)}
                className={cn(
                  'ink-box px-5 py-2 font-stamp text-[15px] leading-none transition-colors',
                  board === entry
                    ? 'text-brass-100 brightness-125'
                    : 'text-ink-300 opacity-70 hover:text-brass-300 hover:opacity-100',
                )}
              >
                {LEADERBOARD_BOARD_LABELS[entry]}
              </button>
            ))}
          </div>

          {/* The scope. A real checkbox rather than a second pair of tabs: it is one question with
              a yes and a no, and it applies to whichever board is open. */}
          <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-ink-200">
            <input
              type="checkbox"
              checked={localOnly}
              onChange={(event) => setLocalOnly(event.target.checked)}
              data-testid="local-only"
              className="h-4 w-4 accent-brass-500"
            />
            My city only
            {cityName && <span className="text-ink-400">({cityName})</span>}
          </label>
        </div>

        <div
          className="ink-frame card-paper washed rivets edge-lit min-h-0 flex-1 overflow-y-auto"
          data-testid="leaderboard"
        >
          {query.isError ? (
            <LoadFailure what="The standings" onRetry={() => void query.refetch()} />
          ) : !data ? (
            <p className="p-4 font-body text-[13px] italic text-ink-400">Reading the ledger…</p>
          ) : data.entries.length === 0 ? (
            <p className="p-4 font-body text-[13px] italic text-ink-400">
              Nobody has a name here yet.
            </p>
          ) : data.board === 'players' ? (
            <PlayerTable entries={data.entries} youUserId={me.data?.user.id ?? ''} />
          ) : (
            <FactionTable entries={data.entries} />
          )}
        </div>

        <YourPlace data={data} board={board} />
      </div>
    </PageShell>
  );
}

/** Where the reader sits, said plainly, whether or not they are on the page above. */
function YourPlace({
  data,
  board,
}: {
  data: LeaderboardResponse | undefined;
  board: LeaderboardBoard;
}) {
  if (!data) return null;
  return (
    <p
      className="shrink-0 font-body text-[13px] text-ink-300"
      data-testid="your-rank"
      role="status"
    >
      {data.yourRank === null ? (
        board === 'players' ? (
          'You are not on this board yet. Win a fight.'
        ) : (
          'You are in no faction, so there is nothing of yours on this board.'
        )
      ) : (
        <>
          You are <span className="font-display font-bold text-brass-300">#{data.yourRank}</span>
          {data.localOnly ? ' in your city.' : ' across every city.'}
        </>
      )}
    </p>
  );
}

function Head({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-surface-700/70 bg-surface-900/95 px-4 py-2 font-display text-[10px] uppercase tracking-[0.18em] text-ink-400">
      {children}
    </div>
  );
}

/**
 * The rank plate.
 *
 * The top three get the brass: a leaderboard whose first row looks like its fortieth is a list, not
 * a ranking, and the one thing everybody reads a ranking for is who is winning.
 */
function Rank({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        'flex h-8 w-9 shrink-0 items-center justify-center rounded-sm font-display text-[14px] font-bold tabular-nums',
        rank <= 3 ? 'ink-disc text-brass-100' : 'text-ink-400',
      )}
    >
      {rank}
    </span>
  );
}

function PlayerTable({ entries, youUserId }: { entries: PlayerStanding[]; youUserId: string }) {
  return (
    <>
      <Head>
        <span className="w-9 shrink-0 text-center">#</span>
        <span className="min-w-0 flex-1">Name</span>
        <span className="hidden w-40 shrink-0 sm:block">Faction</span>
        <span className="w-14 shrink-0 text-right">Level</span>
        <span className="w-24 shrink-0 text-right">Infamy</span>
      </Head>
      <ul>
        {entries.map((entry) => (
          <li
            key={entry.userId}
            data-testid={`standing-${entry.username}`}
            className={cn(
              'flex items-center gap-3 border-b border-surface-700/60 px-4 py-2 last:border-b-0',
              entry.userId === youUserId && 'bg-brass-300/10',
            )}
          >
            <Rank rank={entry.rank} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-stamp text-[15px] leading-tight text-ink-100">
                {entry.username}
                {entry.userId === youUserId && (
                  <span className="ml-1.5 text-[11px] text-brass-300">you</span>
                )}
                {entry.isBot && <span className="ml-1.5 text-[11px] text-ink-500">house</span>}
              </span>
              <span className="truncate font-body text-[11px] leading-tight text-ink-400">
                {entry.districtName}
              </span>
            </span>
            <span className="hidden w-40 shrink-0 items-center gap-2 sm:flex">
              {entry.factionBadge && <FactionBadge badge={entry.factionBadge} size={22} />}
              <span className="truncate font-body text-[12px] text-ink-300">
                {entry.factionName ?? <span className="text-ink-500">none</span>}
              </span>
            </span>
            <span className="w-14 shrink-0 text-right font-display text-[13px] tabular-nums text-ink-200">
              {entry.level}
            </span>
            <span className="w-24 shrink-0 text-right font-display text-[14px] font-bold tabular-nums text-brass-300">
              {Math.round(entry.infamy).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function FactionTable({ entries }: { entries: FactionStanding[] }) {
  return (
    <>
      <Head>
        <span className="w-9 shrink-0 text-center">#</span>
        <span className="min-w-0 flex-1">Faction</span>
        <span className="w-16 shrink-0 text-right">Seats</span>
        <span className="w-14 shrink-0 text-right">Top</span>
        <span className="w-24 shrink-0 text-right">Earned</span>
      </Head>
      <ul>
        {entries.map((entry) => (
          <li
            key={entry.factionId}
            data-testid={`standing-${entry.name}`}
            className="flex items-center gap-3 border-b border-surface-700/60 px-4 py-2 last:border-b-0"
          >
            <Rank rank={entry.rank} />
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <FactionBadge badge={entry.badge} size={28} />
              <span className="truncate font-stamp text-[15px] leading-tight text-ink-100">
                {entry.name}
              </span>
            </span>
            <span className="w-16 shrink-0 text-right font-display text-[13px] tabular-nums text-ink-200">
              {entry.members}
            </span>
            <span className="w-14 shrink-0 text-right font-display text-[13px] tabular-nums text-ink-200">
              {entry.topLevel}
            </span>
            <span className="w-24 shrink-0 text-right font-display text-[14px] font-bold tabular-nums text-brass-300">
              {Math.round(entry.infamy).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
