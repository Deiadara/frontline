import {
  BLUEPRINTS,
  ITEM_CATALOG,
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
 * meanings. A board offer's `give` is what the other allegiance hands over, so it is what you
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
  reimagining: { hasHeadOfResearch: false, hasReimaginingResearch: false },
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

/**
 * The composer's item picker only offers what a listing may actually move.
 *
 * `offerRefusal` refuses a listing that moves an untradeable item, and an unlocked blueprint is the
 * one kind in the catalogue that is. The picker listed the whole satchel, so the single item a
 * player cannot trade was offered to them beside the ones they can, and the only way to learn that
 * was to fill in the rest of the form and be turned down.
 */
describe('the offer composer', () => {
  const document = BLUEPRINTS[0];
  const page = document.pages[0];

  beforeEach(() => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market'))
        return reply({ ...market, inventory: { [document.id]: 1, [page.id]: 2 } });
      throw new Error(`unstubbed request: ${path}`);
    });
  });

  it('offers a page and not the document it belongs to', async () => {
    renderMarket();
    fireEvent.click(await screen.findByTestId('offer-item'));

    const options = (await screen.findAllByRole('option')).map((node) => node.textContent ?? '');
    // A page is named "<document>: <page>", so a substring match on the document's own name would
    // be satisfied by the page. Count instead: "Nothing", plus the one item that may be traded.
    expect(
      options,
      `expected Nothing and the page only, got ${JSON.stringify(options)}`,
    ).toHaveLength(2);
    expect(options[0]).toContain('Nothing');
    expect(options[1]).toContain(ITEM_CATALOG[page.id].name);
  });
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
    await waitFor(() => expect(screen.getByText(/Today he is in at/)).toHaveTextContent('14:00'));
    expect(screen.getByText(/Today he is in at/)).not.toHaveTextContent('17:00');
  });
});

/**
 * A posted offer leaves the composer, because posting it spent the goods.
 *
 * `market/board.ts`'s `postOffer` escrows `give` out of the stockpile the moment the listing goes
 * up, on purpose: a board of listings that cannot be honoured is worse than no board. The form kept
 * the pile and re-enabled its button, so a second press escrowed a second copy, up to
 * `MAX_OPEN_OFFERS = 8` of them. The counter case was quieter: `onDone` cleared `counterTo` and not
 * the bundle, so the same-looking form turned from "counter that listing" into "public listing".
 */
describe('after a listing is posted', () => {
  it('empties the composer rather than leaving a second press armed', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market/offer')) return reply({ market });
      if (path.endsWith('/me')) return reply(meIn('Europe/Athens'));
      if (path.endsWith('/market')) return reply(market);
      throw new Error(`unstubbed request: ${path}`);
    });

    renderMarket();
    await screen.findByTestId('offer-give');

    fireEvent.click(screen.getByTestId('offer-give-oil'));
    fireEvent.change(screen.getByTestId('offer-give-amount-oil'), { target: { value: '400' } });
    fireEvent.click(screen.getByTestId('offer-want-scrap'));
    fireEvent.change(screen.getByTestId('offer-want-amount-scrap'), { target: { value: '400' } });

    // The precondition: the pile really is in the form, so the emptiness asserted below is the
    // post's doing rather than a form that was never filled.
    const post = screen.getByRole('button', { name: 'Post it' });
    expect(post).toBeEnabled();
    expect(screen.getByTestId('offer-give-oil')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(post);

    await waitFor(() =>
      expect(screen.getByTestId('offer-give-oil')).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(screen.getByTestId('offer-want-scrap')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Post it' })).toBeDisabled();
  });
});
