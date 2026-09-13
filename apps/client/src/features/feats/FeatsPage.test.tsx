import { FEAT_CLAIM_REFUSAL_TEXT, FEATS, findFeat, type FeatsResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
