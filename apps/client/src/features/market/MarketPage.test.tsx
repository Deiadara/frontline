import {
  RESOURCE_KEYS,
  STORAGE_SHARES,
  supplyBoard,
  type MarketResponse,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketPage } from './MarketPage';
import { useSession } from '../../store/session';

/**
 * The front of the market: the Runner's window and the day it turns over on.
 *
 * Trading between crews moved to `/game/market/offers` and its cases went with it, into
 * `OffersPage.test.tsx`. What is left here is the two claims this screen makes on its own: that
 * nothing is on the barrow until the Runner is standing behind it, and that every daily boundary
 * is quoted on the house clock rather than on the reader's.
 */

const NOW = '2026-08-26T12:00:00.000Z';

// Off `RESOURCE_KEYS` rather than hand-listed: a hand-listed stockpile that misses a key parses
// as `undefined` and then flows into `supplyBoard` as NaN, and the page shows its loading line
// forever with nothing in the console to say why.
const resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, key === 'caps' ? 50_000 : 4_000]),
) as Resources;

const market: MarketResponse = {
  reimagining: { hasHeadOfResearch: false, hasReimaginingResearch: false },
  serverNow: NOW,
  caps: resources.caps,
  resources,
  inventory: {},
  vendor: {
    open: false,
    sessions: [],
    session: null,
    closesAt: null,
    opensAt: NOW,
    stock: [],
    results: [],
  },
  offers: [
    {
      id: 'offer-1',
      sellerBaseId: 'base-9',
      sellerName: 'The Kettle Row Combine',
      // They hand over a great deal of oil for a little scrap: good for the crew reading it.
      give: { resources: { oil: 4_000 }, items: {} },
      want: { resources: { scrap: 400 }, items: {} },
      status: 'open',
      counterTo: null,
      directedAt: null,
      createdAt: NOW,
    },
  ],
  mine: [],
  supply: supplyBoard(12, resources, 10_000, 0, (key) =>
    Math.round(10_000 * (STORAGE_SHARES[key] ?? 0)),
  ),
  barterRate: 0.5,
};

const fetchMock = vi.fn();

/** `GET /me`, which is where `usePlayerZone` reads the clock the player set in Settings. */
const meIn = (timezone: string) => ({
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: null,
    icon: 'shield',
    timezone,
  },
  overseer: null,
  base: null,
});

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** The market as this player's browser gets it, with the Runner keeping the given game hours. */
function stubMarket(timezone: string, sessions: { startHour: number; hours: number }[] = []): void {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/me')) return reply(meIn(timezone));
    if (path.endsWith('/market'))
      return reply({ ...market, vendor: { ...market.vendor, sessions } });
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderMarket() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The tab strip is three `NavLink`s, so the page needs a router even though nothing under
          test navigates. */}
      <MemoryRouter initialEntries={['/game/market']}>
        <MarketPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/market')) return reply(market);
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The Runner's barrow is covered until he is standing behind it.
 *
 * Both states are driven off the same fixture, because the interesting failure is the shut one
 * rendering the goods with dead buttons: that was the old behaviour, and it made the opening hours
 * a formality by telling a player exactly what to save for hours ahead of time.
 */
describe('the Runner\u2019s barrow', () => {
  const withVendor = (open: boolean): MarketResponse => ({
    ...market,
    vendor: {
      open,
      sessions: [{ startHour: 10, hours: 2 }],
      session: open ? 0 : null,
      closesAt: open ? NOW : null,
      opensAt: NOW,
      // What the server sends: nothing at all while he is away.
      stock: open
        ? [
            {
              line: { id: 'l1', item: 'neural_shunt', stock: 2, price: 1180 },
              auction: {
                lineId: 'l1',
                session: 0,
                closesAt: NOW,
                reserve: 1180,
                leading: null,
                nextBid: 1180,
                bids: [],
                bidders: 0,
                yourBid: null,
              },
            },
          ]
        : [],
      results: [],
    },
  });

  const serve = (open: boolean) =>
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market')) return reply(withVendor(open));
      throw new Error(`unstubbed request: ${path}`);
    });

  it('draws nothing to buy, and says so, while he is out', async () => {
    serve(false);
    renderMarket();
    await screen.findByTestId('vendor-shut');
    expect(screen.queryByTestId('vendor-stock')).toBeNull();
    expect(screen.queryByText('Neural Shunt')).toBeNull();
  });

  it('draws the barrow the moment he is in', async () => {
    serve(true);
    renderMarket();
    const barrow = await screen.findByTestId('vendor-stock');
    expect(screen.queryByTestId('vendor-shut')).toBeNull();
    // Inside the barrow: the tape along the top names the lot too, which is the point of a tape.
    expect(within(barrow).getByText('Neural Shunt')).toBeVisible();
  });

  /**
   * A line is a lot, and the card says so: the figure on its tag is where the lot opens, and the
   * door on it is a bid rather than a purchase. The wire has no buy any more; a card that still
   * said Buy would be a button with no route behind it.
   */
  it('prints the lot as a bid at the opening figure', async () => {
    serve(true);
    renderMarket();
    await screen.findByTestId('vendor-stock');
    expect(screen.getByTestId('lot-tag-l1')).toHaveTextContent('1,180');
    expect(screen.getByTestId('bid-l1')).toHaveTextContent('Bid');
    expect(screen.queryByText('Buy')).toBeNull();
  });
});

/**
 * The day turns over on the house clock, and the screen says so in the player's own.
 *
 * Every daily reset in the game is keyed on an *Athens* date (`marketDay` -> `dayInZone`), which is
 * what makes "the ration is back at midnight" a shared fact rather than four hundred different
 * ones. Two things followed from the copy not knowing that. The ration line said "midnight" flatly,
 * which is 17:00 for a player reading the game in New York. And the Runner's hours, which the rules
 * author in game hours, were rendered through `utcHourInZone`, which reads an Athens hour as if it
 * were a UTC one and puts him in three hours late for everybody, the house clock included.
 *
 * The expected clock times below are worked out by hand rather than taken from the same helpers the
 * page uses, or the test would agree with the page however wrong both were. On 2026-08-26 Athens is
 * UTC+3 and New York is UTC-4:
 *
 * - the next Athens midnight is 2026-08-27 00:00 +03:00 = 2026-08-26T21:00Z = 17:00 in New York
 * - the Runner's 14:00 game hour is 11:00Z, which is 14:00 in Athens and 07:00 in New York
 */
describe('the day boundary is the house clock, quoted on the player’s own', () => {
  it('names the reset as a time rather than as the word midnight', async () => {
    stubMarket('America/New_York');
    renderMarket();

    await waitFor(() => expect(screen.getByText(/resets at/)).toHaveTextContent('resets at 17:00'));
    expect(screen.queryByText(/midnight/i)).toBeNull();
  });

  it('gives the house clock its own midnight', async () => {
    stubMarket('Europe/Athens');
    renderMarket();

    await waitFor(() => expect(screen.getByText(/resets at/)).toHaveTextContent('resets at 00:00'));
  });

  it('reads the Runner’s hours as game hours, not as UTC hours', async () => {
    stubMarket('Europe/Athens', [{ startHour: 14, hours: 2 }]);
    renderMarket();

    // 17:00 is what the same hour renders as if it is mistaken for a UTC one.
    // The hours live on the standing note's hover, on the tab row: open it the way a pointer does.
    const note = await screen.findByTestId('info-note');
    fireEvent.mouseEnter(note);
    await waitFor(() => expect(screen.getByText(/Today he is in at/)).toHaveTextContent('14:00'));
    expect(screen.getByText(/Today he is in at/)).not.toHaveTextContent('17:00');
  });
});
