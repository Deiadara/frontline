import type { BarResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { BarPage } from './BarPage';
import { useSession } from '../../store/session';

/**
 * A walkout standoff has to thaw on a page nobody touches.
 *
 * `serverNow` was `new Date(data.serverNow)`, the response's own timestamp, evaluated once per
 * render of a component with no ticker: `useBar` sets no `refetchInterval`. `coldFor` derives the
 * standoff from it and `cold !== null` replaces the entire hiring door, so a six-hour standoff on a
 * tab left open read "Back in 5h 59m" six hours later and went on refusing a conversation the
 * server would have taken. Six hours is exactly the interval a player leaves a tab alone for.
 */

const NOW = Date.parse('2026-08-26T12:00:00.000Z');

/** One person at the bar, and the crew walked out on them 90 seconds short of the thaw. */
function barWithStandoff(secondsLeft: number): BarResponse {
  const cold = F.bar.recruits.find((recruit) => recruit.standoff !== null);
  if (!cold) throw new Error('the fixture has nobody in a standoff');
  return {
    ...F.bar,
    serverNow: new Date(NOW).toISOString(),
    recruits: [
      {
        ...cold,
        standoff: { until: new Date(NOW + secondsLeft * 1000).toISOString(), walkouts: 1 },
      },
    ],
  };
}

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderBar() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/bar']}>
        <BarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a cold chair', () => {
  it('counts down and reopens while the page is left alone', async () => {
    // 90 seconds of standoff left, and `/bar` will answer exactly once: nothing refetches.
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/bar') ? reply(barWithStandoff(90)) : reply({}),
    );

    renderBar();
    fireEvent.click(await screen.findByTestId('sit-down'));
    await waitFor(() => expect(screen.getByText(/Back in/)).toHaveTextContent('Back in 1m'));

    const readsBefore = fetchMock.mock.calls.length;

    // Two minutes of wall clock, with no interaction and no new response.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    // The door is back, so the standoff thawed on the clock rather than on a refetch...
    await waitFor(() => expect(screen.queryByText(/You walked out on them/)).toBeNull());
    // ...and the proof it was the clock: nothing asked the server anything in between.
    expect(fetchMock.mock.calls.length).toBe(readsBefore);
  });
});
