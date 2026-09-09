import { AUCTION_SEALED_WINDOW_MS, type BarResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { BarPage } from './BarPage';
import { useSession } from '../../store/session';

/**
 * A table's clock has to run on a page nobody is touching.
 *
 * The Bar polls every ten seconds, which is the right interval for other crews' bids and much too
 * slow to be a clock: a table three minutes off its close would sit on the same figure for ten
 * seconds at a time, and the last minute of an auction would be read in six steps. So the
 * countdown ticks locally, off `useServerClock`, and the poll only corrects it.
 *
 * That is the failure this pins, and the Bar has had it before: `serverNow` used to be the
 * response's own timestamp evaluated once per render of a component with no ticker, so a walkout
 * standoff on a tab left open read "Back in 5h 59m" six hours later. The assertion below is
 * therefore made *between* two polls: the time on screen moves while nothing has been asked.
 */

const NOW = Date.parse('2026-08-26T12:00:00.000Z');
/** Ninety seconds off the close, so the table is sealed and the clock is in its `mm:ss` form. */
const CLOSES_AT = NOW + 90_000;

/**
 * One person, one table, and this crew is on it: the room draws its clock on the tables strip, so
 * nothing has to be clicked for the countdown to be on screen.
 */
function barAt(clock: number): BarResponse {
  const recruit = F.bar.recruits[0];
  const table = F.bar.auctions[0];
  if (!recruit || !table) throw new Error('the bar fixture has nobody in tonight');
  return {
    ...F.bar,
    serverNow: new Date(clock).toISOString(),
    recruits: [recruit],
    auctions: [
      {
        ...table,
        recruitId: recruit.id,
        sealedFrom: new Date(CLOSES_AT - AUCTION_SEALED_WINDOW_MS).toISOString(),
        closesAt: new Date(CLOSES_AT).toISOString(),
        phase: 'sealed',
        yourBid: 120,
        leading: {
          username: 'operator',
          amount: 120,
          at: new Date(NOW - 60_000).toISOString(),
          yours: true,
        },
        bidders: 2,
      },
    ],
    auctionsUsed: 1,
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

/** The `mm:ss` on the tables strip, as seconds. */
function onTheClock(): number {
  const chip = screen.getByTestId(`table-${F.bar.recruits[0]?.id ?? ''}`);
  const shown = /(\d+):(\d\d)/.exec(chip.textContent ?? '');
  if (!shown) throw new Error(`no mm:ss on the chip: ${chip.textContent}`);
  return Number(shown[1]) * 60 + Number(shown[2]);
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

describe('a table’s clock', () => {
  it('counts down between polls, on a page nobody touches', async () => {
    // A live server: every answer carries the clock it was written at, which is what
    // `useServerClock` corrects the browser against.
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/bar') ? reply(barAt(Date.now())) : reply({}),
    );

    renderBar();
    await waitFor(() => expect(onTheClock()).toBe(90));
    const readsBefore = fetchMock.mock.calls.length;

    // Five seconds of wall clock, which is less than the ten-second poll: nothing is asked in
    // between, so anything that moves on screen moved because of the local tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(onTheClock()).toBe(85);
    expect(
      fetchMock.mock.calls.length,
      'the clock was refreshed by a refetch rather than by ticking',
    ).toBe(readsBefore);
  });

  it('runs the table out and closes it without being asked again', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/bar') ? reply(barAt(Date.now())) : reply({}),
    );

    renderBar();
    await waitFor(() => expect(onTheClock()).toBe(90));

    // Past the close. The phase on the wire still says `sealed`, because it is a snapshot of the
    // moment the response was built; the screen derives it from the two boundaries instead, so the
    // table reads as closed the second it is.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });

    await waitFor(() =>
      expect(screen.getByTestId(`table-${F.bar.recruits[0]?.id ?? ''}`)).toHaveTextContent(
        'closed',
      ),
    );
  });
});
