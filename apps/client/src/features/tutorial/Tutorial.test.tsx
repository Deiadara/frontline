import { TERMINUS_CITY_ID, TUTORIAL_STEPS, homePlots } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { Tutorial } from './Tutorial';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';

/**
 * The opening tutorial on screen: what draws, what the two controls write, and what stops it.
 *
 * The rules under test are the maintainer's: a card per screen on a first visit, a Skip on every
 * card that ends all of them, no close cross, and nothing at all once the set is complete.
 */
const fetchMock = vi.fn();

function seat(seen: readonly string[], districtId = F.base.districtId) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.me, {
    ...F.me,
    user: { ...F.me.user, tutorialSeen: [...seen] },
    base: { ...F.base, districtId },
  });
  return queryClient;
}

function draw(screenName: string, seen: readonly string[], districtId?: string) {
  const queryClient = seat(seen, districtId);
  render(
    <QueryClientProvider client={queryClient}>
      <Tutorial screen={screenName} />
    </QueryClientProvider>,
  );
  return queryClient;
}

/** What the component posted, as the step list the server would receive. */
const posted = (): string[] => {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('nothing was posted');
  const body: unknown = JSON.parse(String((call[1] as { body: string }).body));
  if (typeof body !== 'object' || body === null || !('steps' in body)) {
    throw new Error('the request carried no steps');
  }
  const { steps } = body;
  if (!Array.isArray(steps)) throw new Error('steps was not a list');
  return steps.map(String);
};

beforeEach(() => {
  useSession.setState({ signedIn: true, user: null });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      headers: new Headers(),
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve({ user: F.me.user }),
    } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the opening tutorial on screen', () => {
  it('draws the first city card to a player who has seen nothing', () => {
    draw('city', []);
    expect(screen.getByTestId('tutorial-card-welcome')).toBeVisible();
    expect(screen.getByTestId('tutorial-next')).toBeVisible();
    expect(screen.getByTestId('tutorial-skip')).toBeVisible();
  });

  /**
   * The maintainer asked for the decision to be on the card rather than on a cross.
   *
   * `Modal` draws its close button only when it is `dismissible`, so this is asserting that the
   * card does not pass that flag: a player's two ways out are Skip and Next, and both of them
   * write something.
   */
  it('offers no close cross, so the only ways out are Skip and Next', () => {
    draw('city', []);
    expect(screen.queryByTestId('modal-close')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  /*
   * Bug pass, 2026-10-06: the window's own Escape and backdrop closes ran Skip, so a stray click
   * beside the card wrote every step as seen and the tutorial never came back.
   */
  it('stays, and writes nothing, on Escape or a press on the dimmed backdrop', async () => {
    draw('city', []);
    fireEvent.keyDown(window, { key: 'Escape' });
    const backdrop = screen.getByTestId('tutorial-card').parentElement!;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('tutorial-card-welcome')).toBeVisible();
  });

  it('marks only this card seen when the player goes on', async () => {
    draw('city', []);
    fireEvent.click(screen.getByTestId('tutorial-next'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(posted()).toEqual(['welcome']);
  });

  it('marks every card seen when the player skips, which is what stops the rest', async () => {
    draw('city', []);
    fireEvent.click(screen.getByTestId('tutorial-skip'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(posted().sort()).toEqual([...TUTORIAL_STEPS].sort());
  });

  it('draws the card belonging to the screen it is put on', () => {
    draw('battles', []);
    expect(screen.getByTestId('tutorial-card-battles')).toBeVisible();
  });

  it('draws nothing on a screen the tutorial says nothing about', () => {
    draw('scrapyard', []);
    expect(screen.queryByTestId('tutorial-card')).toBeNull();
  });

  it('draws nothing once every card has been seen, which is every player after the first hour', () => {
    draw('city', [...TUTORIAL_STEPS]);
    expect(screen.queryByTestId('tutorial-card')).toBeNull();
  });

  /**
   * Nothing before `/me` has answered.
   *
   * An empty set means "show the first card", so a component that drew while the read was still
   * in flight would flash the welcome card at a player who finished the tutorial months ago. The
   * cache is deliberately left empty here and no request is allowed to complete.
   */
  it('draws nothing until the account has actually been read', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Tutorial screen="city" />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('tutorial-card')).toBeNull();
  });

  /** The welcome card named Ashfall to a crew that had just picked Terminus (bug pass, 2026-09-29). */
  it('names the welcome card after the city the crew lives in', () => {
    draw('city', [], homePlots(TERMINUS_CITY_ID)[0]);
    expect(screen.getByRole('heading', { name: 'Terminus' })).toBeVisible();
  });

  it('counts the cards so the player knows the set ends', () => {
    draw('city', []);
    expect(screen.getByTestId('tutorial-card').textContent).toContain(
      `of ${TUTORIAL_STEPS.length}`,
    );
  });
});

/** Bug pass, 2026-10-06: what a press on the card shows before and after the server answers. */
describe('a press on the card', () => {
  const answer = (path: string, settled: Response) =>
    fetchMock.mockImplementation((called: string) =>
      String(called).endsWith(path)
        ? Promise.resolve(settled)
        : // The re-read of `/me` never lands: what is on screen is what the answer itself wrote.
          new Promise(() => {}),
    );

  it('takes the card away on the answer, without waiting for the account to be read again', async () => {
    answer(
      '/settings/tutorial',
      new Response(
        JSON.stringify({
          ...F.settings,
          user: { ...F.me.user, tutorialSeen: [...TUTORIAL_STEPS] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    draw('city', []);
    fireEvent.click(screen.getByTestId('tutorial-skip'));
    await waitFor(() => expect(screen.queryByTestId('tutorial-card')).toBeNull());
  });

  it('says why a press did not save', async () => {
    answer(
      '/settings/tutorial',
      new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Not saved' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    draw('city', []);
    fireEvent.click(screen.getByTestId('tutorial-next'));
    expect(await screen.findByTestId('tutorial-error')).toHaveTextContent('Not saved');
  });
});
