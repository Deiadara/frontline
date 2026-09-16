import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { LeaderboardPage } from './LeaderboardPage';
import { useSession } from '../../store/session';

/**
 * The sort menu and the search field on the players' board (maintainer request, 2026-09-12).
 *
 * Asserted through the screen rather than through `players.ts`, which has its own tests: what is
 * being checked here is the wiring, and every one of these would have passed against a page that
 * computed the right order and drew the old one.
 *
 * The two destinations are rendered as real routes so a press can be followed to where it lands. A
 * test that asserted on an `href` would say nothing about the keyboard path, which is the half of a
 * hand-drawn combobox that is easy to get wrong.
 */

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function Landed({ what }: { what: string }) {
  const { id } = useParams<{ id: string }>();
  return <p data-testid={`landed-${what}`}>{id}</p>;
}

async function renderBoard() {
  const rendered = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/leaderboard']}>
        <Routes>
          <Route path="/game/leaderboard" element={<LeaderboardPage />} />
          <Route path="/game/crews/:id" element={<Landed what="crew" />} />
          <Route path="/game/factions/:id" element={<Landed what="faction" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByTestId('standing-Nikos');
  return rendered;
}

/** The names in the table, top to bottom. */
function rows(): string[] {
  return within(screen.getByTestId('leaderboard'))
    .getAllByRole('listitem')
    .map((row) => row.getAttribute('data-testid')?.replace('standing-', '') ?? '');
}

/** Picks a choice out of the painted sort menu the way a player does. */
async function sortBy(label: RegExp) {
  fireEvent.click(screen.getByTestId('standings-sort'));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

const type = (text: string) =>
  fireEvent.change(screen.getByTestId('standings-search'), { target: { value: text } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (String(path).includes('/leaderboard?board=factions')) return reply(F.leaderboardFactions);
    if (String(path).includes('/leaderboard')) return reply(F.leaderboardPlayers);
    if (String(path).endsWith('/me')) return reply(F.me);
    throw new Error(`unstubbed request: ${String(path)}`);
  });
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('sorting the players board', () => {
  it('opens in the order the server ranked, with the menu on Standing', async () => {
    await renderBoard();
    const board = F.leaderboardPlayers.board === 'players' ? F.leaderboardPlayers.entries : [];
    expect(rows()).toEqual(board.map((entry) => entry.username));
    expect(screen.getByTestId('standings-sort')).toHaveTextContent('Standing');
  });

  it('redraws the table by level when Level is picked', async () => {
    await renderBoard();
    await sortBy(/^Level/);
    await waitFor(() => expect(rows()[0]).toBe('Vex_Combine'));
    expect(rows()).toEqual(['Vex_Combine', 'Marrow', 'Ash_Wren', 'Sable_Ninth', 'Nikos']);
  });

  /**
   * The one the board actually asked for: `totalInfamy`, not `infamy`. Ash_Wren is last on the
   * wallet and first on the lifetime total, so a menu wired to the wrong field cannot pass this.
   */
  it('redraws the table by lifetime total when Total infamy is picked', async () => {
    await renderBoard();
    await sortBy(/^Total infamy/);
    await waitFor(() => expect(rows()[0]).toBe('Ash_Wren'));
    expect(rows().indexOf('Ash_Wren')).toBeLessThan(rows().indexOf('Sable_Ninth'));
  });

  /*
   * The figure column has to be the figure the board is ranked on (maintainer request, 2026-09-12).
   *
   * Sorting by lifetime total put Ash_Wren on top while the column still printed their wallet,
   * 1,200, above Sable_Ninth's 9,840. The order was right and the only number on screen said it
   * was wrong, which a player reads as a broken screen rather than as a second measure.
   */
  it('prints the figure it sorted on, not the wallet regardless', async () => {
    await renderBoard();
    const board = F.leaderboardPlayers.board === 'players' ? F.leaderboardPlayers.entries : [];
    const wren = board.find((entry) => entry.username === 'Ash_Wren');
    if (!wren) throw new Error('fixture error: no Ash_Wren on the players board');
    // The precondition: the two figures for this crew are different numbers.
    expect(wren.totalInfamy).not.toBe(wren.infamy);

    const figure = () => screen.getByTestId('standing-figure-Ash_Wren').textContent;
    expect(figure()).toBe(Math.round(wren.infamy).toLocaleString());
    expect(screen.getByTestId('leaderboard')).toHaveTextContent('Infamy');

    await sortBy(/^Total infamy/);
    await waitFor(() => expect(figure()).toBe(Math.round(wren.totalInfamy).toLocaleString()));
    // And the heading says which of the two the reader is looking at.
    expect(screen.getByTestId('leaderboard')).toHaveTextContent('Total');
  });

  it('leaves the rank column saying where each crew sits on the board', async () => {
    await renderBoard();
    await sortBy(/^Level/);
    await waitFor(() => expect(rows()[0]).toBe('Vex_Combine'));
    // Vex is second on the board and first in the table: the sort reorders, it does not re-rank.
    expect(screen.getByTestId('standing-Vex_Combine')).toHaveTextContent('2');
  });
});

describe('searching for a player', () => {
  it('narrows the table to the rows that answer', async () => {
    await renderBoard();
    type('marrow');
    await waitFor(() => expect(rows()).toEqual(['Marrow']));
  });

  it('says so when nothing answers, rather than drawing an empty sheet', async () => {
    await renderBoard();
    type('zzz');
    expect(await screen.findByTestId('standings-no-match')).toHaveTextContent('zzz');
  });

  it('recommends the best match first', async () => {
    await renderBoard();
    type('ni');
    const found = within(await screen.findByTestId('standings-suggestions'))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(found[0]).toContain('Nikos');
    expect(found.some((entry) => entry.includes('Sable_Ninth'))).toBe(true);
  });

  it('offers nothing at all until something is typed', async () => {
    await renderBoard();
    expect(screen.queryByTestId('standings-suggestions')).toBeNull();
  });

  /**
   * Picking a suggestion answers "where are they on this board", not "who are they".
   *
   * The search sits on the standings, so the row is the answer: the rank, the figure, and the
   * crews either side of them. It used to navigate to the crew file instead, which threw away the
   * board the search had just been run against (maintainer request, 2026-09-14).
   */
  it('takes a recommendation to that player’s place on the board', async () => {
    await renderBoard();
    type('sable');
    fireEvent.click(await screen.findByTestId('standings-suggestion-Sable_Ninth'));

    // Still on the standings, with that row picked out of the hundred.
    expect(screen.queryByTestId('landed-crew')).toBeNull();
    expect(await screen.findByTestId('standing-Sable_Ninth')).toHaveAttribute(
      'data-sought',
      'true',
    );
  });

  it('goes to the same place on enter, without the mouse', async () => {
    await renderBoard();
    type('marrow');
    await screen.findByTestId('standings-suggestions');
    fireEvent.keyDown(screen.getByTestId('standings-search'), { key: 'Enter' });

    expect(screen.queryByTestId('landed-crew')).toBeNull();
    expect(await screen.findByTestId('standing-Marrow')).toHaveAttribute('data-sought', 'true');
  });

  /** The name inside the row is the other door, and it still opens the file. */
  it('opens the crew file when the name inside the row is pressed', async () => {
    await renderBoard();
    type('sable');
    fireEvent.click(await screen.findByTestId('standings-suggestion-name-Sable_Ninth'));
    expect(await screen.findByTestId('landed-crew')).toHaveTextContent('ally-user');
  });

  it('walks the recommendations with the arrow keys', async () => {
    await renderBoard();
    type('ni');
    await screen.findByTestId('standings-suggestions');
    const field = screen.getByTestId('standings-search');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    // The second suggestion, taken to its place on the board rather than to a file.
    expect(await screen.findByTestId('standing-Sable_Ninth')).toHaveAttribute(
      'data-sought',
      'true',
    );
  });

  /*
   * A combobox nobody can dismiss (regression, 2026-09-13).
   *
   * The list is `absolute z-20` over the top of the ranked sheet and nothing but escape, a
   * keystroke or a pick ever put it away. Clicking anywhere else left it hanging over the first
   * five rows of the table for as long as the screen was open, and opening the sort menu beside it
   * left two menus on screen at once: `Dropdown` closes on a window `pointerdown` and this did not,
   * so the two controls in one strip behaved differently.
   */
  it('puts the suggestions away when the reader presses somewhere else', async () => {
    await renderBoard();
    type('ni');
    await screen.findByTestId('standings-suggestions');

    fireEvent.pointerDown(screen.getByTestId('standings-sheet'));
    await waitFor(() => expect(screen.queryByTestId('standings-suggestions')).toBeNull());
    // What was typed survives: the table is still narrowed, only the recommendations are gone.
    expect(screen.getByTestId('standings-search')).toHaveValue('ni');
  });

  /**
   * The other half, and the one a naive "close on any pointerdown" breaks: pressing *on* a
   * suggestion has to reach it. A listener that closed first would unmount the link under the
   * finger and the click would land on the table.
   */
  it('keeps the list up for a press on the list itself', async () => {
    await renderBoard();
    type('sable');
    const suggestion = await screen.findByTestId('standings-suggestion-Sable_Ninth');

    fireEvent.pointerDown(suggestion);
    expect(screen.getByTestId('standings-suggestions')).toBeVisible();
    fireEvent.click(suggestion);
    expect(await screen.findByTestId('standing-Sable_Ninth')).toHaveAttribute(
      'data-sought',
      'true',
    );
  });

  it('puts the list away on escape and keeps what was typed', async () => {
    await renderBoard();
    type('ni');
    await screen.findByTestId('standings-suggestions');
    fireEvent.keyDown(screen.getByTestId('standings-search'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('standings-suggestions')).toBeNull());
    expect(screen.getByTestId('standings-search')).toHaveValue('ni');
  });
});

describe('the faction column', () => {
  it('is a door to that faction file', async () => {
    await renderBoard();
    fireEvent.click(screen.getByTestId('standing-faction-Nikos'));
    expect(await screen.findByTestId('landed-faction')).toHaveTextContent('faction-1');
  });

  it('stays plain text for a crew at no table', async () => {
    await renderBoard();
    expect(screen.queryByTestId('standing-faction-Marrow')).toBeNull();
    expect(screen.getByTestId('standing-Marrow')).toHaveTextContent('none');
  });
});

/**
 * How the board is drawn (maintainer request, 2026-09-13).
 *
 * The drawings themselves are SVG and a unit test has nothing useful to say about a laurel. What is
 * asserted here is what the drawings are *wired to*: which three rows are on the podium, that it
 * summarises the board as ranked rather than as re-sorted, that the reader's own row is marked and
 * reachable, and that the rank cell still reads as the rank alone, which is the contract
 * `social.spec.ts` proves a tie with.
 */
describe('the shape of the board', () => {
  /** The names on the podium, in the order they are drawn into the DOM. */
  function podium(): string[] {
    return within(screen.getByTestId('standings-podium'))
      .getAllByRole('link')
      .map((card) => card.getAttribute('data-testid')?.replace('podium-', '') ?? '');
  }

  it('strikes the top three of the board as places', async () => {
    await renderBoard();
    expect(podium()).toEqual(['Sable_Ninth', 'Vex_Combine', 'Nikos']);
    expect(screen.getByTestId('podium-Sable_Ninth')).toHaveAttribute('data-place', '1');
  });

  /**
   * The podium answers "who is winning", which is a question about the board and not about the
   * menu. Re-sorted by level, the table opens on Vex and the podium still says Sable_Ninth.
   */
  it('keeps the podium on the board as ranked when the table is re-sorted', async () => {
    await renderBoard();
    await sortBy(/^Level/);
    await waitFor(() => expect(rows()[0]).toBe('Vex_Combine'));
    expect(podium()[0]).toBe('Sable_Ninth');
  });

  it('draws no podium for a board too short to have a top three', async () => {
    // Two rows on the board: the fixture's factions, which is the honest short case.
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/me')) return reply(F.me);
      return reply(F.leaderboardFactions);
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <LeaderboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('standing-The Ninth Circle');
    expect(screen.queryByTestId('standings-podium')).toBeNull();
  });

  /**
   * The rank cell holds the rank and nothing else.
   *
   * `social.spec.ts` proves a tie shares its place by reading the first child of a row, so a mark
   * or a medal that put text in front of the number would break a gate in another file. The medal
   * is an `<svg>` behind the numeral and the reader's mark is drawn out of the flow, both on
   * purpose, and this is the assertion that says so.
   */
  it('leaves the rank cell reading as the rank alone', async () => {
    await renderBoard();
    for (const [name, rank] of [
      ['Sable_Ninth', '1'],
      ['Nikos', '3'],
      ['Ash_Wren', '5'],
    ] as const) {
      expect(screen.getByTestId(`standing-${name}`).firstElementChild?.textContent?.trim()).toBe(
        rank,
      );
    }
  });

  /** What the street calls them, which was on the wire and was not being drawn. */
  it('prints each crew street name beside their district', async () => {
    await renderBoard();
    expect(screen.getByTestId('standing-Sable_Ninth')).toHaveTextContent('Whispered');
    expect(screen.getByTestId('standing-Marrow')).toHaveTextContent('Nobody');
  });

  it('marks the reader own row and scrolls to it on request', async () => {
    const scrollIntoView = vi.fn();
    // jsdom implements no scrolling at all, so the method has to be put there to be watched.
    Element.prototype.scrollIntoView = scrollIntoView;
    await renderBoard();
    expect(screen.getByTestId('standing-Nikos')).toHaveAttribute('data-you', 'true');

    fireEvent.click(screen.getByTestId('standings-find-me'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('offers no way back to a row a search has taken off the board', async () => {
    await renderBoard();
    expect(screen.getByTestId('standings-find-me')).toBeInTheDocument();
    type('marrow');
    await waitFor(() => expect(screen.queryByTestId('standings-find-me')).toBeNull());
  });
});

/**
 * Pressing between the two boards (regression, 2026-09-13).
 *
 * `useLeaderboard` is keyed on the board as well as on the scope, and its `placeholderData` used to
 * be `(previous) => previous`, which hands the *other board's* answer back across a key change.
 * `LeaderboardResponse` is a union discriminated on `board`, so the page narrowed on the stale
 * payload and drew the full ranked player table under a lit Factions tab, with the player search
 * gone and the plaque at the foot still saying "You are #3", for as long as the faction request
 * was in flight. Every other test in this file answers instantly and never saw it.
 */
describe('while the other board is still coming', () => {
  /** Holds the factions answer until the test lets it go, which is where the glitch lived. */
  function heldFactions() {
    let release = () => undefined as void;
    const held = new Promise<Response>((resolve) => {
      release = () =>
        resolve({
          ok: true,
          status: 200,
          statusText: '',
          json: () => Promise.resolve(F.leaderboardFactions),
        } as Response);
    });
    fetchMock.mockImplementation((path: string) => {
      if (String(path).includes('/leaderboard?board=factions')) return held;
      if (String(path).includes('/leaderboard')) return reply(F.leaderboardPlayers);
      if (String(path).endsWith('/me')) return reply(F.me);
      throw new Error(`unstubbed request: ${String(path)}`);
    });
    return { release: () => release() };
  }

  it('draws no player rows under a lit Factions tab', async () => {
    const { release } = heldFactions();
    await renderBoard();
    expect(screen.getByTestId('standing-Nikos')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('board-factions'));
    await waitFor(() =>
      expect(screen.getByTestId('board-factions')).toHaveAttribute('aria-selected', 'true'),
    );

    // The ranked table the reader is no longer asking for, and the plaque that quotes its number.
    expect(screen.queryByTestId('standing-Nikos')).toBeNull();
    expect(screen.queryByTestId('standing-Sable_Ninth')).toBeNull();
    expect(screen.queryByTestId('your-rank')).toBeNull();

    release();
    expect(await screen.findByTestId('standing-The Ninth Circle')).toBeVisible();
    expect(screen.getByTestId('your-rank')).toHaveTextContent('#1');
  });
});

/**
 * The screen under a hand that will not stop pressing (maintainer request, 2026-09-13).
 *
 * Not a benchmark. Each of these is a control whose state is derived rather than accumulated, and
 * the failure they are aimed at is the one a single press never shows: a row drawn twice, a menu
 * left standing, a scope that ends up disagreeing with its own checkbox, or a refetch per press
 * against a cache that should have answered.
 */
describe('under a lot of pressing', () => {
  /** How many times `fetch` was asked for a board, so a cached answer stays a cached answer. */
  const boardReads = () =>
    fetchMock.mock.calls.filter((call) => String(call[0]).includes('/leaderboard')).length;

  it('survives forty flips between the two boards', async () => {
    await renderBoard();
    for (let press = 0; press < 40; press++) {
      fireEvent.click(screen.getByTestId(press % 2 === 0 ? 'board-factions' : 'board-players'));
    }
    await waitFor(() => expect(screen.getByTestId('standing-Nikos')).toBeInTheDocument());

    const drawn = rows();
    expect(drawn).toHaveLength(5);
    expect(new Set(drawn).size).toBe(drawn.length);
    /*
     * Bounded well under the press count: the two keys settle out of the cache rather than each
     * press putting a request on the wire. Not pinned to an exact number, which would be pinning
     * this file's `QueryClient` defaults rather than the behaviour, but a page that refetched per
     * press lands at forty and fails here.
     */
    expect(boardReads()).toBeLessThan(8);
  });

  it('survives sixty presses through the sort menu', async () => {
    await renderBoard();
    for (let press = 0; press < 60; press++) {
      fireEvent.click(screen.getByTestId('standings-sort'));
      const options = screen.queryAllByRole('option');
      const pick = options[press % Math.max(1, options.length)];
      if (pick) fireEvent.click(pick);
    }
    await waitFor(() => expect(screen.getByTestId('standing-Nikos')).toBeInTheDocument());

    expect(rows()).toHaveLength(5);
    // Nothing left standing: every opened menu was closed by the press that chose from it.
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);

    /*
     * And the way back is still the way back.
     *
     * `Standing` returns the server's own order, which only holds if every one of those sixty
     * sorts worked on a copy. A `sortPlayers` that reordered the rows it was handed would leave
     * the board permanently in whatever order the last press asked for, and the one control that
     * is supposed to undo the other two would undo nothing.
     */
    await sortBy(/^Standing/);
    const served = F.leaderboardPlayers.board === 'players' ? F.leaderboardPlayers.entries : [];
    await waitFor(() => expect(rows()).toEqual(served.map((entry) => entry.username)));
  });

  it('survives the scope being toggled thirty times', async () => {
    await renderBoard();
    for (let press = 0; press < 30; press++) fireEvent.click(screen.getByTestId('local-only'));
    await waitFor(() => expect(screen.getByTestId('standing-Nikos')).toBeInTheDocument());

    // An even number of presses, so the box is where it started and the sheet agrees with it.
    expect(screen.getByTestId<HTMLInputElement>('local-only')).not.toBeChecked();
    expect(rows()).toHaveLength(5);
  });

  it('survives a name being typed and rubbed out letter by letter', async () => {
    await renderBoard();
    for (const text of ['n', 'ni', 'nik', 'niko', 'nikos', 'niko', 'ni', 'n', '', 'sa', 'sab']) {
      type(text);
    }
    await waitFor(() => expect(rows()).toEqual(['Sable_Ninth']));
    // One field, one answer: the last thing typed is what is on screen, not a race between two.
    expect(
      within(screen.getByTestId('standings-suggestions'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([expect.stringContaining('Sable_Ninth')]);
  });

  it('scrolls once per press of Find me and leaves the board alone', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    await renderBoard();
    for (let press = 0; press < 25; press++)
      fireEvent.click(screen.getByTestId('standings-find-me'));

    expect(scrollIntoView).toHaveBeenCalledTimes(25);
    expect(rows()).toHaveLength(5);
    expect(screen.getByTestId('standing-Nikos')).toHaveAttribute('data-you', 'true');
  });

  it('lands once when a recommendation is pressed over and over', async () => {
    await renderBoard();
    type('sable');
    const suggestion = await screen.findByTestId('standings-suggestion-Sable_Ninth');
    for (let press = 0; press < 10; press++) fireEvent.click(suggestion);

    // Ten presses, one destination, one marked row. The `?focus=` param is consumed on arrival,
    // so a tenth press cannot stack a tenth scroll on a reader who has moved on.
    const marked = screen.getAllByTestId('standing-Sable_Ninth');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute('data-sought', 'true');
  });
});

describe('the factions board', () => {
  async function openFactions() {
    await renderBoard();
    fireEvent.click(screen.getByTestId('board-factions'));
    return screen.findByTestId('standing-The Ninth Circle');
  }

  /**
   * A faction is a badge with seats at it, so the identity cell says how full the table is and the
   * columns rank what a rival wants: the mean level, the best of them, and what the badge has won.
   */
  it('says how full each table is, and what its average is worth', async () => {
    const row = await openFactions();
    expect(row).toHaveTextContent('2 of 5 seats');
    // `averageLevel` has been on the wire since the maintainer asked for it, and the screen dropped it.
    expect(row).toHaveTextContent('9');
    expect(screen.getByTestId('standing-Rust Assembly')).toHaveTextContent('4 of 5 seats');
  });

  it('is a door to each faction file, which the row used not to be', async () => {
    await openFactions();
    fireEvent.click(screen.getByTestId('standing-link-Rust Assembly'));
    expect(await screen.findByTestId('landed-faction')).toHaveTextContent('faction-2');
  });
});
