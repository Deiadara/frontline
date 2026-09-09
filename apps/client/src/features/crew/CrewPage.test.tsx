import { maxOpenAuctionsFor, OFFICER_ROLES, type CrewResponse } from '@frontline/shared';
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
 *
 * The sentence also has to describe the mechanic the Bar actually runs. It said "you may sign a
 * limited number a day" for a fortnight after §H7a replaced the hire button with a city-wide
 * auction: nobody is signed on the spot any more, the limit is on tables rather than on people,
 * and the number is `maxOpenAuctionsFor`, which moves at level 40.
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
    await waitFor(() => expect(window).toHaveTextContent('signs them at 17:00'));
    expect(window).not.toHaveTextContent(/midnight/i);
  });

  it('still says 00:00 for a player on the house clock itself', async () => {
    stub('Europe/Athens');

    const window = await openEmptyChair();
    await waitFor(() => expect(window).toHaveTextContent('signs them at 00:00'));
  });

  it('describes the auction, not the hire button it replaced', async () => {
    stub('Europe/Athens');

    const window = await openEmptyChair();
    await waitFor(() => expect(window).toHaveTextContent('The Bar is an auction'));
    // The cap is on tables, and it is the shared number the server gates bids on.
    expect(window).toHaveTextContent(`${maxOpenAuctionsFor(crew.level)} tables at once`);
    // What it must not still promise: a hire on the spot, or a daily allowance of people.
    expect(window).not.toHaveTextContent(/sign a limited number/i);
    expect(window).not.toHaveTextContent(/hires? a day/i);
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

  /**
   * A benched officer carries a door to a chair (board request, 2026-09-09).
   *
   * The card used to be one big button that opened the file, and the chair list was a dropdown
   * inside it: two presses and a hunt, for the one thing a benched officer is there for. The door
   * is drawn on the card and opens the same file with the chair list in it.
   */
  it('puts an Assign door on a benched officer that opens their chair list', async () => {
    stubWith(staffed, () => null);
    renderCrew();
    const bench = await screen.findByTestId('crew-bench', {}, { timeout: 4000 });
    const doors = within(bench).getAllByTestId(/^assign-chair-/);
    expect(doors.length).toBeGreaterThan(0);
    fireEvent.click(doors[0]!);
    await screen.findByTestId('reassign-role');
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

/**
 * The order of the nineteen cards (board pass, 2026-09-09).
 *
 * In catalogue order alone a crew of three opened this screen on four empty chairs and had every
 * officer it had hired below the fold, on the one screen whose subject is those officers. The
 * people come first; the empty chairs keep the catalogue's order behind them.
 */
describe('which chairs are at the top', () => {
  const seatedRole = seatedOfficer.role ?? '';

  it('puts the people before the empty chairs, whatever order the catalogue is in', async () => {
    // The precondition: the seated officer must not already be first in `OFFICER_ROLES`, or the
    // assertion would hold with no ordering at all.
    expect(OFFICER_ROLES.indexOf(seatedOfficer.role!)).toBeGreaterThan(0);

    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/me')) return reply(meIn('Europe/Athens'));
      if (path.endsWith('/crew')) return reply(staffed);
      throw new Error(`unstubbed request: ${path}`);
    });
    renderCrew();
    await screen.findByTestId(`seat-${seatedRole}`);

    const seats = [...document.querySelectorAll('[data-testid^="seat-"]')].map((card) =>
      card.getAttribute('data-testid'),
    );
    expect(seats).toHaveLength(OFFICER_ROLES.length);
    expect(seats[0]).toBe(`seat-${seatedRole}`);
    // And the empties behind them are still in the catalogue's own order, so a chair moves only
    // when somebody sits down in it.
    const empties = seats.slice(1).map((id) => (id ?? '').replace('seat-', ''));
    expect(empties).toEqual(OFFICER_ROLES.filter((role) => role !== seatedOfficer.role));
  });
});
