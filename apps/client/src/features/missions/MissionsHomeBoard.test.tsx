import type { MissionsResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { useViewedCity } from '../../store/viewedCity';
import { MissionsPage } from './MissionsPage';

/**
 * The board is the crew's own city's, so this screen has no city to pick (maintainer, 2026-10-07).
 *
 * "You can only do missions in your starting city." Until then this sheet carried the same picker
 * the Bar, the market and the back room carry, and asked the server for whichever city the player
 * was last looking at. Two things had to go with the rule, and a screen that kept either would be
 * lying to the player: the control itself, and the `?city=` on the read.
 *
 * The second is the one worth a test, because it is invisible. The store this page used to read
 * (`useViewedCity`) is shared with the other rooms and is still set by them, so a player who
 * switches the Bar to Terminus and then opens the missions sheet is exactly the case where a
 * leftover read would ask for the wrong city and get somebody else's boards back.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** Every path the page asked for, in order, so the query string can be read back. */
const asked: string[] = [];

function board(): MissionsResponse {
  return {
    ...F.missionsResponse(new Date(NOW)),
    cityId: 'ashfall',
    // The door list the other rooms share. The page carries it and must not act on it.
    cities: ['ashfall', 'terminus'],
  };
}

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    asked.push(path);
    if (path.includes('/missions')) return reply(board());
    if (path.endsWith('/me')) return reply(F.me);
    // Everything else this page polls answers empty rather than throwing: what is under test is
    // the one request above, and a throw here would fail the render for an unrelated reason.
    return reply({});
  });
  useSession.setState({ signedIn: true, user: null });
  useViewedCity.setState({ cityId: 'terminus', crew: 'base-1', rooms: ['ashfall', 'terminus'] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useViewedCity.setState({ cityId: null, crew: null, rooms: null });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the missions sheet and the city a player was last looking at', () => {
  it('reads its own board, naming no city, with another city remembered', async () => {
    renderPage();
    await screen.findByTestId('mission-board');

    const reads = asked.filter((path) => path.includes('/missions'));
    expect(reads.length, 'the board was never read').toBeGreaterThan(0);
    for (const path of reads) expect(path, 'the board asked for a city').not.toContain('city=');
  });

  it('draws no city picker', async () => {
    renderPage();
    await screen.findByTestId('mission-board');

    expect(screen.queryByTestId('city-picker')).toBeNull();
  });
});
