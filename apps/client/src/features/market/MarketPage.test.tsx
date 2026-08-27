import {
  RESOURCE_CAP_VALUE,
  RESOURCE_KEYS,
  STORAGE_SHARES,
  supplyBoard,
  type MarketResponse,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketPage } from './MarketPage';
import { FAIR_BAND, valueVerdict } from './TradeParts';
import { useSession } from '../../store/session';

/**
 * The market's one arithmetic claim: whether a deal is good for *you*.
 *
 * Both sides of this screen price a trade, and the two objects they price arrive with opposite
 * meanings. A board offer's `give` is what the other faction hands over, so it is what you
 * receive; the composer's field called `give` is what leaves your own store. Feed the second one
 * into a badge written for the first and the screen congratulates a player for proposing a deal
 * that robs them, which is a worse failure than printing nothing at all.
 */

const NOW = '2026-08-26T12:00:00.000Z';

// Off `RESOURCE_KEYS` rather than hand-listed: a hand-listed stockpile that misses a key parses
// as `undefined` and then flows into `supplyBoard` as NaN, and the page shows its loading line
// forever with nothing in the console to say why.
const resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, key === 'caps' ? 50_000 : 4_000]),
) as Resources;

const market: MarketResponse = {
  serverNow: NOW,
  caps: resources.caps,
  resources,
  inventory: {},
  vendor: { open: false, sessions: [], closesAt: null, opensAt: NOW, stock: [] },
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

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderMarket() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The tab strip is a pair of `NavLink`s, so the page needs a router even though nothing
          under test navigates. */}
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

describe('the fairness verdict', () => {
  it('reads a lopsided trade from the receiver’s side', () => {
    expect(valueVerdict(1_000, 100).label).toBe('in your favour');
    expect(valueVerdict(100, 1_000).label).toBe('steep');
    expect(valueVerdict(1_000, 1_000).label).toBe('about fair');
    expect(valueVerdict(1_000, 0).label).toBe('a gift');
  });

  it('calls a generous offer on the board what it is', async () => {
    renderMarket();
    // 4,000 oil in for 400 scrap out: the badge on the listing, not on the composer.
    expect(await screen.findByText('in your favour')).toBeVisible();
  });

  /**
   * The composer's own badge, driven through the controls a player uses.
   *
   * `give` there is what *leaves*, so an offer of a mountain of oil for a handful of scrap is the
   * mirror of the listing above and has to read as the opposite. Both assertions are here on
   * purpose: a badge wired to the wrong pair of bundles passes whichever one it was written
   * against, so only the pair together pins the orientation.
   */
  it('calls the player’s own over-generous proposal steep', async () => {
    renderMarket();
    await screen.findByTestId('offer-give');

    // Oil out, scrap in, at the same lopsided ratio the board offer runs the other way.
    fireEvent.click(screen.getByTestId('offer-give-oil'));
    fireEvent.change(screen.getByTestId('offer-give-amount-oil'), { target: { value: '4000' } });
    fireEvent.click(screen.getByTestId('offer-want-scrap'));
    fireEvent.change(screen.getByTestId('offer-want-amount-scrap'), { target: { value: '400' } });

    // The precondition the expectation rests on, priced by the market's own table: the proposal
    // hands over far more value than it asks back, well outside the band that reads as fair.
    expect(4_000 * RESOURCE_CAP_VALUE.oil).toBeGreaterThan(
      (1 + FAIR_BAND) * 400 * RESOURCE_CAP_VALUE.scrap,
    );

    await waitFor(() => {
      // Two badges are on screen now: the board's, which stays generous, and the composer's.
      expect(screen.getByText('steep')).toBeVisible();
      expect(screen.getByText('in your favour')).toBeVisible();
    });
  });
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
      closesAt: open ? NOW : null,
      opensAt: NOW,
      // What the server sends: nothing at all while he is away.
      stock: open
        ? [{ line: { id: 'l1', item: 'neural_shunt', stock: 2, price: 1180 }, affordable: true }]
        : [],
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
    await screen.findByTestId('vendor-stock');
    expect(screen.queryByTestId('vendor-shut')).toBeNull();
    expect(screen.getByText('Neural Shunt')).toBeVisible();
  });
});
