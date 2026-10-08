import {
  CITIES,
  LEADERBOARD_BOARDS,
  LEADERBOARD_BOARD_LABELS,
  findCity,
  type LeaderboardBoard,
  type LeaderboardResponse,
} from '@frontline/shared';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
 * board tabs, a city picker, a numbered table, and your own place called out whether or not you
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
 * ## What the city picker does, and what it does not
 *
 * It picks the names and never the numbers (maintainer, 2026-10-07): a city lists everybody holding
 * ground there, wherever they live, and every figure beside them is still that player's across the
 * whole world. There is no "my city" any more, and no number on this screen is per city.
 */

/**
 * What the picker holds while no city is picked.
 *
 * The scope is a city id or nothing at all, and a painted {@link Dropdown} carries strings, so the
 * "nothing" needs a value of its own. It is not a city id, and an id that collided with it would
 * send no city at all for that city: `LeaderboardPage.test.tsx` picks every city the world has and
 * reads the request each one put on the wire, which is the shape that collision takes.
 */
const EVERY_CITY = 'every-city';

/**
 * Every city a player may be listed for, the world first.
 *
 * The open ones only. A city that is shut has no crews on its ground and no rooms to walk into, so
 * naming it would offer a board that is empty by construction, and the server answers a shut city
 * with the world anyway. Built once: the list is the world's and does not change while the screen
 * is open.
 */
const CITY_OPTIONS = [
  { value: EVERY_CITY, label: 'All cities' },
  ...CITIES.filter((one) => one.open).map((one) => ({ value: one.id, label: one.name })),
];

/** The screen itself: the tabs, the picker, the sheet and the plaque at its foot. */
export function LeaderboardPage() {
  const [board, setBoard] = useState<LeaderboardBoard>('players');
  /** The city whose holders are listed. Null is every city, which is where the screen opens. */
  const [city, setCity] = useState<string | null>(null);
  const [sort, setSort] = useState<PlayerSort>('standing');
  const [search, setSearch] = useState('');
  const query = useLeaderboard(board, city);
  const me = useMe();
  const data = query.data;
  const youRow = useRef<HTMLLIElement | null>(null);

  /*
   * The crew the search sent us to look at (`?focus=<username>`).
   *
   * Read from the URL so the destination survives a reload and can be linked to, then **copied
   * into state** and stripped from the bar. The two steps are separate on purpose. Consuming the
   * param and marking the row off the param directly does not work: deleting it re-renders with
   * no focus, so the highlight is gone on the same tick it was drawn and the reader is scrolled
   * into the middle of a hundred identical rows with nothing picked out. The state holds the mark;
   * the URL only has to carry the instruction once.
   */
  const [params, setParams] = useSearchParams();
  const [sought, setSought] = useState<string | undefined>(undefined);
  const focusParam = params.get('focus') ?? undefined;
  const focusRow = useRef<HTMLLIElement | null>(null);
  /*
   * One scroll per pick (bug pass, 2026-10-06). Keyed on the data alone, every refetch that
   * changed the board snapped the sheet back to the searched row, however far the reader had
   * scrolled since; and picking the same name twice did not scroll at all, since the state did
   * not change. A pick asks for a scroll, and the scroll spends the ask.
   */
  const [scrollAsked, setScrollAsked] = useState(0);
  const scrolledFor = useRef(0);
  useEffect(() => {
    if (focusParam === undefined) return;
    setSought(focusParam);
    setScrollAsked((asked) => asked + 1);
    const next = new URLSearchParams(params);
    next.delete('focus');
    setParams(next, { replace: true });
  }, [focusParam, params, setParams]);

  /*
   * Scrolled once the row exists, which is not the same tick the instruction arrives: the table is
   * drawn from a query that may still be in flight. `data` is in the dependencies so a board that
   * loads after the search lands still gets its scroll.
   */
  useEffect(() => {
    if (sought === undefined || scrolledFor.current === scrollAsked) return;
    if (focusRow.current === null) return;
    scrolledFor.current = scrollAsked;
    // Optional call: jsdom has no `scrollIntoView` at all, and the unit tests drive this path.
    // Same precedent as `faction/Fights.tsx`.
    focusRow.current.scrollIntoView?.({ block: 'center' });
  }, [sought, data, scrollAsked]);

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
   * The podium summarises the board **as ranked**, so it is drawn off the rows the server sent
   * rather than off whatever the search field has left on screen: a "top three" that reshuffled
   * when somebody typed three letters would be answering a different question. Under "Total
   * infamy" it ranks by total, the figure it prints (maintainer, 2026-10-02); see `playerLeaders`.
   */
  const leaders =
    data?.board === 'players'
      ? playerLeaders(data.entries, sort, youUserId)
      : data
        ? factionLeaders(data.entries)
        : [];

  /*
   * The city, which applies to whichever board is open. No label beside it: the button reads
   * "All cities" or the city's name, which says what it is the way the Bar's own door does, and
   * the strip has no room for a word it does not need. Defined once and placed *inside* the
   * players' controls row rather than beside it: as a sibling of a `flex-1` row it wrapped onto a
   * line of its own at 1280x720 and cost the sheet its fifth ranking (e2e, 2026-10-07).
   */
  const cityPicker = (
    // The width on a wrapper, not on the picker: a `Dropdown` fills whatever holds it, so a
    // width class on it reaches nothing, and a bare one in a wrapping row took the whole row.
    <div className="w-[10rem] shrink-0">
      <Dropdown<string>
        label="Which city’s players to list"
        value={city ?? EVERY_CITY}
        onChange={(next) => setCity(next === EVERY_CITY ? null : next)}
        options={CITY_OPTIONS}
        data-testid="standings-city"
      />
    </div>
  );

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
              {cityPicker}
            </div>
          )}
          {board !== 'players' && cityPicker}
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
            {/* Only with nothing to show (bug pass, 2026-10-06): a failed background refetch kept
                its data, and the table turned into a failure box between a live podium and a
                live rank plaque. */}
            {query.isError && !data ? (
              <LoadFailure what="The standings" onRetry={() => void query.refetch()} />
            ) : !data ? (
              <p className="p-4 font-body text-[13px] italic text-ink-400">Reading the ledger…</p>
            ) : data.entries.length === 0 ? (
              /* A city with nobody on its ground is a real answer and not an empty screen, so it
                 says which city it looked at. */
              <p
                className="p-4 font-body text-[13px] italic text-ink-400"
                data-testid="standings-empty"
              >
                {data.city === null
                  ? 'Nobody has a name here yet.'
                  : `Nobody holds ground in ${findCity(data.city)?.name ?? data.city} yet.`}
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
                <PlayerBoard
                  entries={rows}
                  youUserId={youUserId}
                  youRow={youRow}
                  focus={sought}
                  focusRow={focusRow}
                  sort={sort}
                />
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
  // Named rather than the raw id, and the id itself if the world has forgotten the city.
  const cityName = data.city === null ? null : (findCity(data.city)?.name ?? data.city);
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
          /*
           * Why you are off the board, which a city makes a second question: a board of one city
           * lists whoever holds ground there, so the reader who holds none is absent from it with
           * nothing wrong on their side. Saying "win a fight" to them would be the wrong answer.
           */
          board === 'players' ? (
            cityName === null ? (
              'You are not on this board yet. Win a fight.'
            ) : (
              `You hold nothing in ${cityName}, so you are not on this board.`
            )
          ) : cityName === null ? (
            'You are in no faction, so there is nothing of yours on this board.'
          ) : (
            `No faction of yours holds ground in ${cityName}.`
          )
        ) : (
          <>
            You are{' '}
            <span className="font-display text-[16px] font-bold text-brass-300">
              #{data.yourRank}
            </span>
            {/* The rank is a place on the board being read, so it says which board that is. Every
                other figure on the screen is the whole world's and needs no such line. */}
            {cityName === null
              ? ' across every city.'
              : ` among those who hold ground in ${cityName}.`}
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
