import type { CrewResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { CrewPage } from './CrewPage';
import { useSession } from '../../store/session';

/**
 * The Bar's roster turns over on the *house* clock, and the chair window has to say so.
 *
 * `bar/roster.ts` keys the roster on an Athens date, the same date every other daily reset in the
 * game uses. The window used to say "The Bar turns over at midnight" flatly, which is true for a
 * player reading the game in Athens and wrong by the offset for everybody else: a player in New
 * York who waits up for their own midnight has been able to sign for seven hours already.
 *
 * The expected times are worked out by hand rather than from the helpers the page uses. At the
 * instant below Athens is UTC+3 and New York is UTC-4, so the next Athens midnight is
 * 2026-08-27 00:00 +03:00 = 2026-08-26T21:00Z, which is 17:00 in New York.
 */

const NOW = new Date('2026-08-26T12:00:00.000Z');

const crew: CrewResponse = {
  level: 4,
  housing: { used: 0, capacity: 12 },
  officers: [],
};

/**
 * Two on the books: one in a chair, so the officer window opens, and one on the bench, so the chair
 * window has somebody to assign. A chair window with an empty bench draws no picker at all.
 */
const seatedOfficer = F.crewFat.officers.find((officer) => officer.role !== null);
const benchedOfficer = F.crewFat.officers.find((officer) => officer.role !== seatedOfficer?.role);
if (!seatedOfficer || !benchedOfficer) throw new Error('the fixture has too few officers');
const staffed: CrewResponse = {
  ...crew,
  officers: [seatedOfficer, { ...benchedOfficer, role: null }],
};

/** A refusal in the shared error envelope, which is what the routes actually answer with. */
const refusal = (code: string, message: string) =>
  Promise.resolve({
    ok: false,
    status: 409,
    statusText: '',
    json: () => Promise.resolve({ error: { code, message } }),
  } as Response);

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** `GET /me`, which is where `usePlayerZone` reads the clock the player set in Settings. */
const meIn = (timezone: string) => ({
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW.toISOString(),
    displayName: null,
    icon: 'shield',
    timezone,
  },
  overseer: null,
  base: null,
});

function stub(timezone: string): void {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/me')) return reply(meIn(timezone));
    if (path.endsWith('/crew')) return reply(crew);
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderCrew() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The window's door to the Bar is an `InkButton`, which is a `Link`. */}
      <MemoryRouter initialEntries={['/game/crew']}>
        <CrewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Open the chair window on an empty seat, which is where the roster line is drawn. */
async function openEmptyChair() {
  renderCrew();
  await waitFor(() => expect(screen.getByTestId('seat-head_spy')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('seat-head_spy'));
  return screen.getByTestId('chair-window');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('when the Bar turns over', () => {
  it('quotes the house boundary on the clock the player reads the game in', async () => {
    stub('America/New_York');

    const window = await openEmptyChair();
    await waitFor(() => expect(window).toHaveTextContent('The Bar turns over at 17:00'));
    expect(window).not.toHaveTextContent(/midnight/i);
  });

  it('still says 00:00 for a player on the house clock itself', async () => {
    stub('Europe/Athens');

    const window = await openEmptyChair();
    await waitFor(() => expect(window).toHaveTextContent('The Bar turns over at 00:00'));
  });
});

/**
 * A refused write says what the server said.
 *
 * The release banner printed one guess ("You may not have the caps") for every failure, including
 * the two other refusals `releaseOfficer` produces and every transport failure, so a player whose
 * request failed for any other reason was sent to check a number that was fine. Reassignment printed
 * nothing at all: the mutation was read only for `isPending`, and the window staying open was the
 * whole of the feedback.
 */
describe('when the books refuse a change', () => {
  const stubWith = (
    officers: CrewResponse,
    refuse: (path: string) => Promise<Response> | null,
  ): void => {
    fetchMock.mockImplementation((path: string) => {
      const refused = refuse(path);
      if (refused) return refused;
      if (path.endsWith('/me')) return reply(meIn('Europe/Athens'));
      if (path.endsWith('/crew')) return reply(officers);
      throw new Error(`unstubbed request: ${path}`);
    });
  };

  it('prints the server’s reason for a refused release, not a guess about caps', async () => {
    stubWith(staffed, (path) =>
      path.endsWith('/bar/release')
        ? refusal('NOT_ENOUGH_UNITS', 'Nobody on your books by that id')
        : null,
    );

    renderCrew();
    fireEvent.click(await screen.findByTestId(`seat-${seatedOfficer.role ?? ''}`));
    fireEvent.click(await screen.findByTestId('let-go'));
    fireEvent.click(await screen.findByTestId('confirm-let-go'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Nobody on your books by that id'),
    );
    expect(screen.queryByText(/may not have the caps/)).toBeNull();
  });

  it('says why a reassignment did not take', async () => {
    stubWith(staffed, (path) =>
      path.endsWith('/crew/reassign')
        ? refusal('ROLE_TAKEN', 'Somebody is already in that chair')
        : null,
    );

    renderCrew();
    // An empty chair, opened from the grid: assigning from the bench is the same mutation.
    fireEvent.click(await screen.findByTestId('seat-head_spy'));
    const bench = await screen.findByTestId('bench-picker');
    fireEvent.click(within(bench).getAllByRole('button')[0]!);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Somebody is already in that chair'),
    );
  });
});
