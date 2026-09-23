import { FEAT_CLAIM_REFUSAL_TEXT, FEATS, findFeat, type FeatsResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { FeatsPage } from './FeatsPage';
import { useSession } from '../../store/session';

/**
 * The feats screen (maintainer request, 2026-09-13).
 *
 * The four assertions worth having are the four the screen can get wrong while still rendering
 * perfectly: a shut rung printing a figure the server deliberately withheld, a CLAIM button on a
 * rung the claim route will refuse, a filter that looks applied and is not, and a refusal that
 * lands nowhere the player can see. The rest of the page is pictures.
 *
 * The fixture is the e2e board, so the unit gates and the browser run are looking at one set of
 * numbers: a screenshot the board signs off on and a test that passes on different data is two
 * claims about two screens.
 */

const BOARD = F.featsBoard;
const fetchMock = vi.fn();

const reply = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The one ladder that carries every state: collected, ready, part way along, and shut. */
const CLAIMED = 'runs_1';
const READY = 'runs_2';
const OPEN = 'runs_3';
const LOCKED = 'runs_4';
/**
 * The other ladder in these tests, and the reason it is a ladder rather than a rung.
 *
 * The board opens one chain at a time now, so two CLAIM buttons can only be pressed together when
 * they are rungs of the **same** ladder. `pages` is the fixture's pair: two rungs waiting, one
 * card. See `FEATS_READY` in the fixtures.
 */
const PAIR = 'pages';
const READY_A = 'pages_1';
const READY_B = 'pages_2';
/** How long that ladder is. It is one of the eight the catalogue runs up to tier X. */
const RUNS_STEPS = FEATS.filter((feat) => feat.chain === 'runs').length;
/** How many ladders the index holds: every chain, plus one row for each feat that stands alone. */
const LADDERS = new Set(FEATS.map((feat) => feat.chain ?? feat.id)).size;

/** The board the server answers with once these rungs have been collected. */
const collectedBoard = (...ids: readonly string[]): FeatsResponse => {
  const progress = BOARD.progress.map((one) =>
    ids.includes(one.id)
      ? { ...one, state: 'claimed' as const, value: one.target, progress: 1 }
      : one,
  );
  return {
    ...BOARD,
    progress,
    ready: progress.filter((one) => one.state === 'ready').length,
    claimed: progress.filter((one) => one.state === 'claimed').length,
  };
};

/** What a refused claim answers with, in the shape `apiFetch` reads. */
const refusal = (message: string) => ({ error: { code: 'FEAT_REFUSED', message } });

/** The board a test wants on screen. Defaults to the shared fixture. */
async function openBoard(
  claimAnswer?: (() => Promise<Response>) | FeatsResponse,
  boardOverride?: FeatsResponse,
) {
  // The first argument carries a board rather than a claim answer when a test wants a different
  // starting state, which is the common case now that two of them do.
  const answer = typeof claimAnswer === 'function' ? claimAnswer : undefined;
  const board = boardOverride ?? (typeof claimAnswer === 'object' ? claimAnswer : BOARD);
  fetchMock.mockImplementation((path: string) => {
    const url = String(path);
    if (url.endsWith('/feats/claim-all')) {
      return reply({ featIds: [READY], paid: findFeat(READY)?.reward, feats: { ...board } });
    }
    if (url.endsWith('/feats/claim')) {
      return (
        answer?.() ?? reply({ featId: READY, paid: findFeat(READY)?.reward, feats: { ...board } })
      );
    }
    if (url.endsWith('/feats')) return reply(board);
    if (url.endsWith('/me')) return reply(F.me);
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/feats']}>
        <FeatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('feats-board');
}

/**
 * Open a ladder from the index down the left.
 *
 * The board is a list of ladders and one open ladder (maintainer, 2026-09-17), so a test that wants
 * a particular chain's rungs on screen has to press its row first. The board opens on the first
 * ladder in the catalogue, which is `runs`.
 */
const openLadder = (key: string) => fireEvent.click(screen.getByTestId(`feats-tab-${key}`));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the board', () => {
  /**
   * The index down the left, and the ladder it opens on the right (maintainer, 2026-09-17).
   *
   * The board used to draw every ladder at once and fold most of their rungs away to fit. Four
   * hundred feats made that unworkable: what is here now is a list a player can run their eye down
   * and the whole of whichever one they pressed.
   */
  it('lists every ladder, and opens the first one whole', async () => {
    await openBoard();
    const sidebar = screen.getByTestId('feats-sidebar');
    expect(within(sidebar).getAllByRole('button')).toHaveLength(LADDERS);

    // The whole of the first ladder, every rung of it, collected and shut ones included.
    const ladder = screen.getByTestId('feat-block-runs');
    expect(ladder.querySelectorAll('[data-testid^="feat-runs_"]')).toHaveLength(RUNS_STEPS);
    for (const id of [CLAIMED, READY, OPEN, LOCKED]) {
      expect(screen.getByTestId(`feat-${id}`), id).toBeInTheDocument();
    }
    expect(screen.getByTestId('feat-spine-runs')).toBeInTheDocument();
    // ...and only that one. The other sixty-nine are rows in the index, not cards on the sheet.
    expect(screen.queryByTestId('feat-block-clean')).toBeNull();
  });

  it('opens whichever ladder is pressed, and closes the one that was open', async () => {
    await openBoard();
    openLadder('clean');
    await waitFor(() => expect(screen.getByTestId('feat-block-clean')).toBeInTheDocument());
    expect(screen.queryByTestId('feat-block-runs')).toBeNull();
    expect(screen.getByTestId('feats-tab-clean')).toHaveAttribute('aria-current', 'true');
  });

  /**
   * The rows that are asking for a press say so, and the ones that are not do not.
   *
   * The index is seventy rows of the same shape, so the only thing that can make one of them
   * findable is how it is drawn. A ladder with a rung waiting is the one row on this page that is
   * asking a player to do something, and it carries the count.
   */
  it('marks the ladders with something waiting, and counts it', async () => {
    await openBoard();
    expect(screen.getByTestId('feats-tab-runs')).toHaveAttribute('data-state', 'unclaimed');
    expect(screen.getByTestId('feats-tab-ready-runs')).toHaveTextContent('1');
    expect(screen.getByTestId('feats-tab-ready-pages')).toHaveTextContent('2');

    // A ladder with nothing waiting carries no count at all, rather than a zero.
    expect(screen.getByTestId('feats-tab-seats')).toHaveAttribute('data-state', 'claimed');
    expect(screen.queryByTestId('feats-tab-ready-seats')).toBeNull();
  });

  /** How far up each ladder the crew is, counted off the catalogue rather than off the screen. */
  it('says how long every ladder is, in the index and on the card', async () => {
    await openBoard();
    expect(screen.getByTestId('feats-tab-done-runs')).toHaveTextContent(`1/${RUNS_STEPS}`);
    expect(screen.getByTestId('feat-block-done-runs')).toHaveTextContent(`1/${RUNS_STEPS}`);
  });

  it('prints where a crew stands on an open rung, with the measure’s own word', async () => {
    await openBoard();
    const standing = BOARD.progress.find((one) => one.id === OPEN);
    expect(screen.getByTestId(`feat-count-${OPEN}`)).toHaveTextContent(
      `${standing?.value} / ${standing?.target} missions`,
    );
    expect(screen.getByTestId(`feat-bar-${OPEN}`)).toBeInTheDocument();
  });

  /** No era anywhere on the page: it went with the mechanic (maintainer, 2026-09-17). */
  it('says nothing about early, mid or late', async () => {
    await openBoard();
    const sheet = screen.getByTestId('feats-summary').closest('div')?.parentElement;
    expect(sheet?.textContent ?? '').not.toMatch(/\b(Early|Mid|Late)\b/);
    for (const era of ['early', 'mid', 'late']) {
      expect(screen.queryByTestId(`feats-era-${era}`), era).toBeNull();
    }
  });
});

describe('a shut rung', () => {
  it('draws no numbers at all: no bar, no figure, and no reward', async () => {
    await openBoard();
    const shut = screen.getByTestId(`feat-${LOCKED}`);
    expect(shut).toHaveAttribute('data-state', 'locked');
    expect(within(shut).queryByRole('progressbar')).toBeNull();
    expect(screen.queryByTestId(`feat-count-${LOCKED}`)).toBeNull();
    expect(screen.queryByTestId(`feat-pays-${LOCKED}`)).toBeNull();
    // The strongest form of the rule, and the one that catches a figure smuggled in anywhere on
    // the row: there is not a digit on it. The catalogue keeps every chained feat's name free of
    // them, so this holds for the name as well as for the progress line.
    expect(shut.textContent ?? '').not.toMatch(/[0-9]/);
  });

  it('says why it is shut rather than leaving a blank rung', async () => {
    await openBoard();
    expect(screen.getByTestId(`feat-${LOCKED}`)).toHaveTextContent('Shut');
  });

  /**
   * Once per ladder, on the door a player could actually open next.
   *
   * The chains run to ten, so a card opened part way up carried six rungs saying the same sentence
   * down its own length. Only the lowest shut one explains itself; the rest are a padlock and a
   * name, which is the whole of what there is to know about a door behind a door.
   */
  it('explains the shut rung once, and only on the next door', async () => {
    await openBoard();
    const shut = screen
      .getAllByTestId(/^feat-runs_/)
      .filter((row) => row.getAttribute('data-state') === 'locked');
    expect(shut.length, 'the fixture ladder has no run of shut rungs').toBeGreaterThan(2);

    const explained = shut.filter((row) => (row.textContent ?? '').includes('Shut'));
    expect(explained).toHaveLength(1);
    expect(explained[0]).toBe(screen.getByTestId(`feat-${LOCKED}`));
    // The ones above it are still drawn, name and padlock, so the ladder's length is visible.
    for (const row of shut) expect(row.textContent ?? '').not.toBe('');
  });
});

describe('the CLAIM button', () => {
  it('is on the finished rung and on no other', async () => {
    await openBoard();
    expect(screen.getByTestId(`feat-claim-${READY}`)).toBeInTheDocument();
    for (const id of [CLAIMED, OPEN, LOCKED]) {
      expect(screen.queryByTestId(`feat-claim-${id}`)).toBeNull();
    }
    // Once, on every ready rung of the ladder that is open, and nowhere else. Counted against the
    // open ladder rather than the catalogue: the other waiting rungs are on cards nobody opened.
    const openReady = BOARD.progress.filter(
      (one) => one.state === 'ready' && findFeat(one.id)?.chain === 'runs',
    );
    expect(openReady.length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Claim this feat/ })).toHaveLength(
      openReady.length,
    );
  });

  /**
   * The door for a backlog, and it is not a second CLAIM.
   *
   * A ladder unlocks on achievement rather than on collection, so a crew can arrive here with more
   * rungs waiting than the write limiter will take one at a time. The button at the head of the
   * board folds them into one write. It appears only when something is waiting, and it announces
   * itself differently from the rungs: two buttons reading "Claim this feat" on one screen is the
   * confusion the label exists to stop.
   */
  it('offers one press for the whole backlog, and says so', async () => {
    await openBoard();
    const all = screen.getByTestId('feats-claim-all');
    const ready = BOARD.progress.filter((one) => one.state === 'ready').length;
    expect(all).toHaveAccessibleName(`Collect all ${ready} finished feats`);
    expect(all).toHaveTextContent(String(ready));
  });

  it('draws no collect-everything button when nothing is waiting', async () => {
    await openBoard({
      ...BOARD,
      ready: 0,
      progress: BOARD.progress.map((one) =>
        one.state === 'ready' ? { ...one, state: 'open' as const } : one,
      ),
    });
    expect(screen.queryByTestId('feats-claim-all')).toBeNull();
  });

  it('stamps a collected rung instead', async () => {
    await openBoard();
    expect(screen.getByTestId(`feat-collected-${CLAIMED}`)).toHaveTextContent('Collected');
  });

  it('collects, and says what was paid', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId(`feat-claim-${READY}`));

    await waitFor(() => expect(screen.getByTestId('feats-receipt')).toBeInTheDocument());
    expect(screen.getByTestId('feats-receipt')).toHaveTextContent(
      `Collected: ${findFeat(READY)?.name}`,
    );
    // The reward echoed back by the server, not the one the client looked up: the receipt has to
    // be what came out of the till.
    expect(screen.getByTestId('feats-receipt-paid')).toBeInTheDocument();

    const posted = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/feats/claim'));
    const body = (posted?.[1] as RequestInit | undefined)?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({ featId: READY });
  });

  /**
   * The rung flips on the response, not on the refetch. This is the flicker.
   *
   * The claim route already answers with the refreshed board, and the page used to throw that away
   * and wait for `invalidateQueries` to fetch the same thing again. In the gap the cache still held
   * the *pre-claim* board, so the rung dropped out of its pending state and drew CLAIM again for a
   * frame or two before finally stamping Collected.
   *
   * Pinned by making the refetch never answer: the only thing left that can move the screen is the
   * claim response itself, so a page that still waited for the GET would sit on CLAIM forever.
   */
  it('stamps the rung off the claim response, without waiting for the board to be refetched', async () => {
    await openBoard();
    const after: FeatsResponse = {
      ...BOARD,
      ready: Math.max(0, BOARD.ready - 1),
      claimed: BOARD.claimed + 1,
      progress: BOARD.progress.map((one) =>
        one.id === READY ? { ...one, state: 'claimed' as const } : one,
      ),
    };
    fetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.endsWith('/feats/claim')) {
        return reply({ featId: READY, paid: findFeat(READY)?.reward, feats: after });
      }
      // The refetch the invalidation kicks off, hung for the life of the test.
      return new Promise<Response>(() => {});
    });

    fireEvent.click(screen.getByTestId(`feat-claim-${READY}`));
    await waitFor(() => expect(screen.getByTestId(`feat-collected-${READY}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`feat-claim-${READY}`)).toBeNull();
  });

  /**
   * Two presses in quick succession, answered out of order (maintainer report, 2026-09-15).
   *
   * Both writes are in flight at once and nothing orders their answers: they are two requests over
   * one multiplexed connection and the first one does more work whenever it pays out a page or a
   * level. Each answer carries the whole board as the server saw it inside its own transaction, so
   * the first press's answer, arriving last, is a board from *before* the second feat was
   * collected. Written straight over the cache, it put a live CLAIM button back on the rung the
   * player had just watched being stamped, and left it there until the invalidation's read landed.
   *
   * Pinned with the refetch hung, the same way the flicker above is: the only thing that may move
   * the screen here is a claim answer, so a page that leans on the GET to tidy up behind it fails.
   */
  it('keeps a collected rung collected when an earlier claim answers last', async () => {
    await openBoard();
    let answerFirstPress: () => void = () => {};
    const firstPress = new Promise<Response>((resolve) => {
      answerFirstPress = () =>
        resolve({
          ok: true,
          status: 200,
          statusText: '',
          json: () =>
            Promise.resolve({
              featId: READY_A,
              paid: findFeat(READY_A)?.reward,
              // The board as it stood when this one was collected: the second rung is still
              // waiting on it, because the second press had not reached the server yet.
              feats: collectedBoard(READY_A),
            }),
        } as Response);
    });
    let claims = 0;
    fetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.endsWith('/feats/claim')) {
        claims += 1;
        return claims === 1
          ? firstPress
          : reply({
              featId: READY_B,
              paid: findFeat(READY_B)?.reward,
              feats: collectedBoard(READY_A, READY_B),
            });
      }
      // Every read hung, so nothing comes along behind the answers to correct them.
      return new Promise<Response>(() => {});
    });

    openLadder(PAIR);
    fireEvent.click(screen.getByTestId(`feat-claim-${READY_A}`));
    fireEvent.click(screen.getByTestId(`feat-claim-${READY_B}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-collected-${READY_B}`)).toBeInTheDocument(),
    );
    expect(claims).toBe(2);

    await act(async () => {
      answerFirstPress();
      // Real time, because the answer travels a promise chain, a cache write and React Query's own
      // batch before anything is drawn, and none of those is a moment the test can wait on.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId(`feat-collected-${READY_A}`)).toBeInTheDocument();
    expect(screen.getByTestId(`feat-collected-${READY_B}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`feat-claim-${READY_B}`)).toBeNull();
    // The ledger counts the same two rungs the board draws, rather than the count off whichever
    // answer landed last.
    expect(screen.getByTestId('feats-ledger-claimed')).toHaveTextContent(String(BOARD.claimed + 2));
  });

  /**
   * The rung under the first press stays pending while its own write is on the wire.
   *
   * The page runs one mutation for a board of two hundred buttons, and an observer only reports
   * its newest mutation: pressing a second CLAIM dropped the first rung straight back to a live,
   * pressable button. Pressing it again then earned an `already_claimed` refusal for a feat that
   * was being collected perfectly correctly. Both answers are hung here, so the only thing under
   * test is what the screen says while two writes are outstanding.
   */
  it('keeps the first rung pending when a second claim is pressed before it answers', async () => {
    await openBoard();
    openLadder(PAIR);
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    fireEvent.click(screen.getByTestId(`feat-claim-${READY_A}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-claim-${READY_A}`)).toHaveTextContent('TAKING'),
    );
    fireEvent.click(screen.getByTestId(`feat-claim-${READY_B}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-claim-${READY_B}`)).toHaveTextContent('TAKING'),
    );

    expect(screen.getByTestId(`feat-claim-${READY_A}`)).toHaveTextContent('TAKING');
    expect(screen.getByTestId(`feat-claim-${READY_A}`)).toBeDisabled();
  });

  /**
   * Collecting the lot says what the lot paid.
   *
   * This drew nothing at all until the bug pass: the page read only the single-claim mutation, so
   * the button a returning player actually presses, and the one that hands over the most, was the
   * one with no feedback. Everything moved (rungs restyled themselves somewhere down a very long
   * page, the stockpile went up in the HUD) and nothing said what had happened.
   */
  it('says what the collect-everything button paid, not just the single one', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-claim-all'));

    await waitFor(() => expect(screen.getByTestId('feats-receipt')).toBeInTheDocument());
    expect(screen.getByTestId('feats-receipt')).toHaveTextContent('Collected: 1 feat');
    expect(screen.getByTestId('feats-receipt-paid')).toBeInTheDocument();
  });

  /** Pressing it with nothing waiting is a success that collected nothing, and draws no receipt. */
  it('draws no receipt when the collect-everything button had nothing to collect', async () => {
    await openBoard();
    fetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.endsWith('/feats/claim-all')) return reply({ featIds: [], paid: {}, feats: BOARD });
      return reply(BOARD);
    });
    fireEvent.click(screen.getByTestId('feats-claim-all'));

    await waitFor(() => expect(screen.getByTestId('feats-claim-all')).toBeEnabled());
    expect(screen.queryByTestId('feats-receipt')).toBeNull();
  });

  /**
   * The state Collect-all can now land in, and the reason the button is not dead in it.
   *
   * A feat that pays units is refused while the district has nowhere to put them (§A1) and stays
   * ready, so the backlog does not empty and the count on the button's face does not move. Without
   * a word on the page that is a control the player presses twice and gives up on. The server says
   * which ones it could not hand over; this draws the sentence.
   */
  it('says why a collect-everything press left some of the backlog behind', async () => {
    await openBoard();
    fetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.endsWith('/feats/claim-all')) {
        return reply({ featIds: [], skipped: [READY], paid: {}, feats: BOARD });
      }
      return reply(BOARD);
    });
    fireEvent.click(screen.getByTestId('feats-claim-all'));

    await waitFor(() => expect(screen.getByTestId('feats-no-room')).toBeInTheDocument());
    expect(screen.getByTestId('feats-no-room')).toHaveTextContent('1 feat is still waiting');
    // Two reasons a rung is passed over now (maintainer, 2026-09-23), nowhere to put the bodies
    // and no room in the stores, so the line names the room rather than one of the two.
    expect(screen.getByTestId('feats-no-room')).toHaveTextContent(
      'there is no room for what it pays',
    );
    expect(screen.getByTestId('feats-no-room')).toHaveTextContent('district or in the stores');
    // Nothing was paid, so no receipt: the two strips never contradict each other.
    expect(screen.queryByTestId('feats-receipt')).toBeNull();
  });

  /** ...and a press that hands everything over says nothing about room. */
  it('says nothing about room when the whole backlog was collected', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-claim-all'));

    await waitFor(() => expect(screen.getByTestId('feats-receipt')).toBeInTheDocument());
    expect(screen.queryByTestId('feats-no-room')).toBeNull();
  });

  it('shows the refusal in the player’s words when the server turns it down', async () => {
    await openBoard(() => reply(refusal('already_claimed'), 409));
    fireEvent.click(screen.getByTestId(`feat-claim-${READY}`));

    await waitFor(() => expect(screen.getByTestId('feats-refusal')).toBeInTheDocument());
    expect(screen.getByTestId('feats-refusal')).toHaveTextContent(
      FEAT_CLAIM_REFUSAL_TEXT.already_claimed,
    );
    expect(screen.queryByTestId('feats-receipt')).toBeNull();
  });
});

describe('the filters', () => {
  /**
   * One axis, over whole ladders (maintainer, 2026-09-17).
   *
   * The era chips are gone with the mechanic, and so is the how-much-of-a-chain setting the sidebar
   * replaced. What is left answers the question a player arrives with: is anything waiting, what
   * have I finished, and what is still in hand.
   */
  it('narrows the index to the ladders with something waiting', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-show-unclaimed'));

    await waitFor(() => expect(screen.queryByTestId('feats-tab-seats')).toBeNull());
    expect(screen.getByTestId('feats-tab-runs')).toBeInTheDocument();
    expect(screen.getByTestId('feats-tab-pages')).toBeInTheDocument();
    expect(screen.getByTestId('feats-show-unclaimed')).toHaveAttribute('aria-pressed', 'true');
    for (const row of within(screen.getByTestId('feats-sidebar')).getAllByRole('button')) {
      expect(row).toHaveAttribute('data-state', 'unclaimed');
    }
  });

  it('narrows to the ladders finished to the top, and back again', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-show-claimed'));
    await waitFor(() => expect(screen.queryByTestId('feats-tab-runs')).toBeNull());
    // `seats` is the fixture's one ladder collected to the top.
    expect(screen.getByTestId('feats-tab-seats')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('feats-show-all'));
    await waitFor(() => expect(screen.getByTestId('feats-tab-runs')).toBeInTheDocument());
  });

  it('narrows to the ladders still in hand', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-show-shut'));
    await waitFor(() => expect(screen.queryByTestId('feats-tab-runs')).toBeNull());
    for (const row of within(screen.getByTestId('feats-sidebar')).getAllByRole('button')) {
      expect(row).toHaveAttribute('data-state', 'shut');
    }
  });

  /**
   * Pressing a chip that filters the open ladder away opens one that is left.
   *
   * The failure this catches is a sidebar beside an empty pane: the board kept the key it had, the
   * filtered list no longer held it, and the right-hand half of the screen simply went blank.
   */
  it('opens a ladder the filter kept when the open one is filtered away', async () => {
    await openBoard();
    expect(screen.getByTestId('feat-block-runs')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('feats-show-claimed'));
    await waitFor(() => expect(screen.queryByTestId('feat-block-runs')).toBeNull());
    expect(screen.getByTestId('feat-block-seats')).toBeInTheDocument();
  });

  it('counts the ladders each setting would leave', async () => {
    await openBoard();
    const countOn = (setting: string) =>
      Number(screen.getByTestId(`feats-show-${setting}`).textContent?.match(/\d+/)?.[0] ?? -1);

    expect(countOn('all')).toBe(LADDERS);
    // The three states are a partition of the whole list, which is what makes the chips add up.
    expect(countOn('claimed') + countOn('unclaimed') + countOn('shut')).toBe(LADDERS);
    expect(countOn('unclaimed')).toBeGreaterThan(0);
  });
});
