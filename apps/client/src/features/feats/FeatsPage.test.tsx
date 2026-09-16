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
/** A second rung the fixture also has waiting, so two claims can be in flight at once. */
const OTHER_READY = 'level_2';

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

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the board', () => {
  it('draws every feat in the catalogue, grouped into its ladders', async () => {
    await openBoard();
    expect(screen.getByTestId('feats-shown')).toHaveTextContent(
      `${FEATS.length} of ${FEATS.length} feats`,
    );
    for (const id of [CLAIMED, READY, OPEN, LOCKED]) {
      expect(screen.getByTestId(`feat-${id}`)).toBeInTheDocument();
    }
    // One card for the four of them, with the upright drawn down it.
    const ladder = screen.getByTestId('feat-block-runs');
    // By rung id rather than by role: a rung's reward is a list of its own inside it, so counting
    // list items here counts the tokens too and the assertion passes at any grouping.
    expect(ladder.querySelectorAll('[data-testid^="feat-runs_"]')).toHaveLength(4);
    expect(screen.getByTestId('feat-spine-runs')).toBeInTheDocument();
  });

  it('prints where a crew stands on an open rung, with the measure’s own word', async () => {
    await openBoard();
    const standing = BOARD.progress.find((one) => one.id === OPEN);
    expect(screen.getByTestId(`feat-count-${OPEN}`)).toHaveTextContent(
      `${standing?.value} / ${standing?.target} missions`,
    );
    expect(screen.getByTestId(`feat-bar-${OPEN}`)).toBeInTheDocument();
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
});

describe('the CLAIM button', () => {
  it('is on the finished rung and on no other', async () => {
    await openBoard();
    expect(screen.getByTestId(`feat-claim-${READY}`)).toBeInTheDocument();
    for (const id of [CLAIMED, OPEN, LOCKED]) {
      expect(screen.queryByTestId(`feat-claim-${id}`)).toBeNull();
    }
    // Once, on every ready feat on the board, and nowhere else.
    const ready = BOARD.progress.filter((one) => one.state === 'ready');
    expect(screen.getAllByRole('button', { name: /Claim this feat/ })).toHaveLength(ready.length);
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
              featId: READY,
              paid: findFeat(READY)?.reward,
              // The board as it stood when this one was collected: the second rung is still
              // waiting on it, because the second press had not reached the server yet.
              feats: collectedBoard(READY),
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
              featId: OTHER_READY,
              paid: findFeat(OTHER_READY)?.reward,
              feats: collectedBoard(READY, OTHER_READY),
            });
      }
      // Every read hung, so nothing comes along behind the answers to correct them.
      return new Promise<Response>(() => {});
    });

    fireEvent.click(screen.getByTestId(`feat-claim-${READY}`));
    fireEvent.click(screen.getByTestId(`feat-claim-${OTHER_READY}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-collected-${OTHER_READY}`)).toBeInTheDocument(),
    );
    expect(claims).toBe(2);

    await act(async () => {
      answerFirstPress();
      // Real time, because the answer travels a promise chain, a cache write and React Query's own
      // batch before anything is drawn, and none of those is a moment the test can wait on.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId(`feat-collected-${READY}`)).toBeInTheDocument();
    expect(screen.getByTestId(`feat-collected-${OTHER_READY}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`feat-claim-${OTHER_READY}`)).toBeNull();
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
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    fireEvent.click(screen.getByTestId(`feat-claim-${READY}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-claim-${READY}`)).toHaveTextContent('TAKING'),
    );
    fireEvent.click(screen.getByTestId(`feat-claim-${OTHER_READY}`));
    await waitFor(() =>
      expect(screen.getByTestId(`feat-claim-${OTHER_READY}`)).toHaveTextContent('TAKING'),
    );

    expect(screen.getByTestId(`feat-claim-${READY}`)).toHaveTextContent('TAKING');
    expect(screen.getByTestId(`feat-claim-${READY}`)).toBeDisabled();
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
    expect(screen.getByTestId('feats-no-room')).toHaveTextContent(
      FEAT_CLAIM_REFUSAL_TEXT.no_unit_slots,
    );
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
  it('narrows to one era, and keeps the rung’s place in its ladder', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-era-mid'));

    await waitFor(() => expect(screen.queryByTestId(`feat-${OPEN}`)).toBeInTheDocument());
    // `runs_3` is the mid rung of that ladder. Its early and late neighbours are gone.
    expect(screen.queryByTestId(`feat-${READY}`)).toBeNull();
    expect(screen.queryByTestId(`feat-${LOCKED}`)).toBeNull();
    expect(screen.getByTestId('feats-era-mid')).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrows to what is done, and to what is not', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-show-done'));
    await waitFor(() => expect(screen.queryByTestId(`feat-${OPEN}`)).toBeNull());
    expect(screen.getByTestId(`feat-${CLAIMED}`)).toBeInTheDocument();
    expect(screen.getByTestId(`feat-${READY}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('feats-show-todo'));
    await waitFor(() => expect(screen.queryByTestId(`feat-${CLAIMED}`)).toBeNull());
    expect(screen.getByTestId(`feat-${OPEN}`)).toBeInTheDocument();
    expect(screen.getByTestId(`feat-${LOCKED}`)).toBeInTheDocument();
  });

  it('combines the two, and neither of them quietly wins', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-era-early'));
    fireEvent.click(screen.getByTestId('feats-show-done'));

    await waitFor(() => expect(screen.getByTestId(`feat-${READY}`)).toBeInTheDocument());
    // `runs_1` and `runs_2` are early and finished; `runs_3` is mid, `runs_4` is late and shut.
    expect(screen.getByTestId(`feat-${CLAIMED}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`feat-${OPEN}`)).toBeNull();
    expect(screen.queryByTestId(`feat-${LOCKED}`)).toBeNull();
    // `level_2` is early and finished, `level_3` is mid and finished by nothing: the era half is
    // doing work here as well as the state half.
    expect(screen.getByTestId('feat-level_2')).toBeInTheDocument();
    expect(screen.queryByTestId('feat-level_3')).toBeNull();
  });

  it('says so rather than drawing an empty board when nothing answers', async () => {
    await openBoard();
    fireEvent.click(screen.getByTestId('feats-era-late'));
    fireEvent.click(screen.getByTestId('feats-show-done'));

    await waitFor(() => expect(screen.getByTestId('feats-empty')).toBeInTheDocument());
    expect(screen.queryByTestId('feats-board')).toBeNull();
  });

  it('counts what each setting would leave, against the other one as it stands', async () => {
    await openBoard();
    expect(screen.getByTestId('feats-era-all')).toHaveTextContent(String(FEATS.length));

    const everything = screen.getByTestId('feats-era-early').textContent ?? '';
    fireEvent.click(screen.getByTestId('feats-show-done'));
    await waitFor(() =>
      expect(screen.getByTestId('feats-era-early').textContent).not.toBe(everything),
    );
  });
});
