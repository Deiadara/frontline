import {
  LEADERBOARD_BOARDS,
  LEADERBOARD_BOARD_LABELS,
  findCity,
  type LeaderboardBoard,
  type LeaderboardResponse,
} from '@frontline/shared';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useLeaderboard, useMe } from '../../lib/queries';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { PageShell } from '../game/PageShell';
import { PlayerSearch } from './PlayerSearch';
import { Podium } from './Podium';
import { FactionBoard, PlayerBoard, factionLeaders, playerLeaders } from './boards';
import {
  PLAYER_SORTS,
  PLAYER_SORT_HINTS,
  PLAYER_SORT_LABELS,
  filterPlayers,
  sortPlayers,
  type PlayerSort,
} from './players';

/**
 * The standings (maintainer request, §J9).
 *
 * The shape every game's ranking screen has, because players arrive already knowing it: a row of
 * board tabs, a scope control, a numbered table, and your own place called out whether or not you
 * are on the page. Drawn in this game's register rather than in a spreadsheet's: the sheet is ruled
 * paper whose lines run past the last entry, the tabs are drawn tabs, the top three are struck in
 * metal inside a laurel, and the reader's own row has a pen mark in the margin. The drawings all
 * live in `ink.tsx`; the two ranked sheets are `boards.tsx`.
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
  const [sort, setSort] = useState<PlayerSort>('standing');
  const [search, setSearch] = useState('');
  const query = useLeaderboard(board, localOnly);
  const me = useMe();
  const data = query.data;
  const youRow = useRef<HTMLLIElement>(null);

  const cityName = data?.scope ? (findCity(data.scope)?.name ?? data.scope) : null;
  /*
   * Sorted and filtered here, over the rows the server already sent.
   *
   * Both controls are a re-read of one page of a hundred rows, not a different question for the
   * server: a sort that went back over the wire would also re-rank, and the `#` column would stop
   * agreeing with the board everybody else is looking at.
   */
  const players = data?.board === 'players' ? data.entries : [];
  const rows = filterPlayers(sortPlayers(players, sort), search);
  const youUserId = me.data?.user.id ?? '';
  /*
   * The podium summarises the board **as ranked**, so it is drawn off the rows in the order the
   * server sent them rather than off whatever the menu and the search field have left on screen.
   * A "top three" that reshuffled when somebody typed three letters would be answering a different
   * question from the one it is labelled with.
   */
  const leaders =
    data?.board === 'players'
      ? playerLeaders(data.entries, sort, youUserId)
      : data
        ? factionLeaders(data.entries)
        : [];

  return (
    <PageShell title="Standings" fills wide>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        {/* One strip, not two. The sheet between the two fixed bars is about 440px tall at 720,
            and a second row of controls took a quarter of what was left for the table: the board
            opened on a column header and one row of ranking. Everything in this strip is one
            control tall, which is what keeps the rest of the height on the table. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
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

          {board === 'players' && (
            <div
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2"
              data-testid="standings-controls"
            >
              <PlayerSearch entries={players} query={search} onQuery={setSearch} />
              {/* The label beside the picker rather than over it, for the room. A `div` and not a
                  `label`: the picker is a button with its own accessible name, and a `<label>`
                  wrapping one associates with nothing. */}
              <div className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                  Sort by
                </span>
                <Dropdown<PlayerSort>
                  label="What to sort the players by"
                  value={sort}
                  onChange={setSort}
                  options={PLAYER_SORTS.map((entry) => ({
                    value: entry,
                    label: PLAYER_SORT_LABELS[entry],
                    hint: PLAYER_SORT_HINTS[entry],
                  }))}
                  className="w-[11.5rem]"
                  data-testid="standings-sort"
                />
              </div>
            </div>
          )}

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

        {/*
         * The sheet scrolls, and the podium scrolls with it.
         *
         * Pinned above the scroller it would cost the ranking a hundred pixels for as long as the
         * page is open; inside it, a reader on rank 40 has the whole sheet and a reader at the top
         * has the answer to "who is winning" before anything else.
         */}
        <div
          className="ink-frame card-paper washed rivets edge-lit flex min-h-0 flex-1 flex-col overflow-y-auto"
          data-testid="standings-sheet"
        >
          <Podium leaders={leaders} />
          <div className="flex min-h-0 flex-1 flex-col" data-testid="leaderboard">
            {query.isError ? (
              <LoadFailure what="The standings" onRetry={() => void query.refetch()} />
            ) : !data ? (
              <p className="p-4 font-body text-[13px] italic text-ink-400">Reading the ledger…</p>
            ) : data.entries.length === 0 ? (
              <p className="p-4 font-body text-[13px] italic text-ink-400">
                Nobody has a name here yet.
              </p>
            ) : data.board === 'players' ? (
              rows.length === 0 ? (
                <p
                  className="p-4 font-body text-[13px] italic text-ink-400"
                  data-testid="standings-no-match"
                >
                  Nobody on this board answers to “{search.trim()}”.
                </p>
              ) : (
                <PlayerBoard entries={rows} youUserId={youUserId} youRow={youRow} sort={sort} />
              )
            ) : (
              <FactionBoard entries={data.entries} />
            )}
          </div>
        </div>

        <YourPlace
          data={data}
          board={board}
          onFind={
            // Offered only when there is a row to scroll to: on the faction board, and whenever a
            // search has hidden the reader, the button would point at nothing.
            board === 'players' && rows.some((entry) => entry.userId === youUserId)
              ? () => youRow.current?.scrollIntoView({ block: 'center' })
              : undefined
          }
        />
      </div>
    </PageShell>
  );
}

/**
 * Where the reader sits, said plainly, whether or not they are on the page above.
 *
 * A plaque rather than a line of prose. It is the one thing on the screen that is about the person
 * reading it, and it was set in the same grey as a caption at the bottom of a sheet of ranking.
 */
function YourPlace({
  data,
  board,
  onFind,
}: {
  data: LeaderboardResponse | undefined;
  board: LeaderboardBoard;
  /** Scrolls the reader's own row into the middle of the sheet, when there is one on it. */
  onFind?: (() => void) | undefined;
}) {
  if (!data) return null;
  return (
    <div
      className="ink-frame card-paper washed edge-lit flex shrink-0 items-center gap-3 px-3.5 py-1.5"
      data-testid="your-rank"
    >
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-brass-500/40 bg-brass-300/10 text-brass-300"
      >
        <Icon name="standings" className="h-3.5 w-3.5" />
      </span>
      <p className="min-w-0 flex-1 font-body text-[13px] text-ink-300" role="status">
        {data.yourRank === null ? (
          board === 'players' ? (
            'You are not on this board yet. Win a fight.'
          ) : (
            'You are in no faction, so there is nothing of yours on this board.'
          )
        ) : (
          <>
            You are{' '}
            <span className="font-display text-[16px] font-bold text-brass-300">
              #{data.yourRank}
            </span>
            {data.localOnly ? ' in your city.' : ' across every city.'}
          </>
        )}
      </p>
      {onFind && (
        <button
          type="button"
          onClick={onFind}
          data-testid="standings-find-me"
          data-sound="click"
          className={cn(
            'brushed shrink-0 rounded-sm border border-surface-600 bg-surface-800/70 px-3 py-1.5',
            'font-display text-[11px] uppercase tracking-[0.14em] text-ink-200',
            'hover:border-brass-500/70 hover:text-brass-100 active:translate-y-px',
          )}
        >
          Find me
        </button>
      )}
    </div>
  );
}
