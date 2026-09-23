import { TUTORIAL_STEPS } from '@frontline/shared';
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

function seat(seen: readonly string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.me, {
    ...F.me,
    user: { ...F.me.user, tutorialSeen: [...seen] },
  });
  return queryClient;
}

function draw(screenName: string, seen: readonly string[]) {
  const queryClient = seat(seen);
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
  useSession.setState({ token: 'session-token', user: null });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve({
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

  it('counts the cards so the player knows the set ends', () => {
    draw('city', []);
    expect(screen.getByTestId('tutorial-card').textContent).toContain(
      `of ${TUTORIAL_STEPS.length}`,
    );
  });
});
