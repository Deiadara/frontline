import {
  DEFAULT_CITY_ID,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  STORAGE_SHARES,
  supplyBoard,
  supplyPrice,
  supplyUnitPrice,
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
  reimagining: { hasResearcher: false, hasReimaginingResearch: false },
  serverNow: NOW,
  cityId: DEFAULT_CITY_ID,
  cities: [DEFAULT_CITY_ID],
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
      cityId: 'ashfall',
      createdAt: NOW,
    },
  ],
  mine: [],
  claims: [],
  supply: supplyBoard(12, resources, 10_000, 0, (key) =>
    Math.round(10_000 * (STORAGE_SHARES[key] ?? 0)),
  ),
  barterRate: 0.5,
  marketDiscountPercent: 0,
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
    headers: new Headers(),
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
  useSession.setState({ signedIn: true, user: null });
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
    await waitFor(() => expect(screen.getByText(/In today at/)).toHaveTextContent('14:00'));
    expect(screen.getByText(/In today at/)).not.toHaveTextContent('17:00');
  });
});

/**
 * The supply run says which of the three refusals it is, and says it about the right shelf.
 *
 * `supplyStall` compared the crew's holding against `supply.storageCapacity`, which is the **bulk**
 * shelf. Oil and supplies get two thirds of that and HQ metal a third (`STORAGE_SHARES`), so for
 * four of the five buyable materials the comparison could not be true and the store-full case fell
 * through to "Not enough caps". A crew with fifty thousand caps and a full alloy shelf was told to
 * go and earn.
 */
/**
 * The Broker and a full shelf (maintainer ruling, 2026-09-28): a warning, not a wall.
 *
 * The server used to refuse a trade the store could not hold, and the panel disabled the button to
 * match. Now the excess is thrown away if the player goes ahead, so the panel says how much before
 * the press and leaves the button live; the till asks again with its own figure.
 */
describe('the Broker on a full shelf', () => {
  it('says how much would go to waste, and still lets the trade be pressed', async () => {
    renderMarket();
    const take = await screen.findByTestId('broker-take');
    // The fixture's alloy shelf is already over its third of the bulk store.
    fireEvent.click(within(take).getByRole('radio', { name: RESOURCE_LABELS.highQualityMetal }));
    const trade = await screen.findByRole('button', { name: 'Trade' });
    await waitFor(() => expect(screen.getByTestId('broker-note')).toHaveTextContent('go to waste'));
    expect(trade).toBeEnabled();
  });

  it('leaves the trade open where there is room, and says nothing about waste', async () => {
    renderMarket();
    const trade = await screen.findByRole('button', { name: 'Trade' });
    expect(trade).toBeEnabled();
    expect(screen.queryByTestId('broker-note')).toBeNull();
  });
});

/**
 * A trade worth nothing back is greyed before the press.
 *
 * Fifteen supplies clear the Broker's minimum count and are worth half a unit of high-quality
 * metal after his cut, which floors to nothing. The server refuses it, so the button says so first.
 */
describe('the Broker on a trade worth nothing', () => {
  it('greys the trade and says why', async () => {
    renderMarket();
    const give = await screen.findByTestId('broker-give');
    fireEvent.click(within(give).getByRole('radio', { name: RESOURCE_LABELS.supplies }));
    const take = screen.getByTestId('broker-take');
    fireEvent.click(within(take).getByRole('radio', { name: RESOURCE_LABELS.highQualityMetal }));
    const amount = screen.getByTestId('broker-amount');
    fireEvent.change(amount, { target: { value: '15' } });
    fireEvent.blur(amount);

    await waitFor(() => expect(screen.getByTestId('broker-note')).toHaveTextContent('Too little'));
    expect(screen.getByRole('button', { name: 'Trade' })).toBeDisabled();
  });
});

describe('why the supply run is refusing', () => {
  const pick = async (label: string) => {
    renderMarket();
    const picker = await screen.findByTestId('supply-resource');
    fireEvent.click(within(picker).getByRole('radio', { name: label }));
  };

  it('says the store is full for a shelf that is narrower than the bulk one', async () => {
    // The fixture holds 4,000 of every material against a bulk shelf of 10,000: room in scrap,
    // and none at all in the alloy shelf, which is a third of it.
    expect(market.resources.highQualityMetal).toBeGreaterThanOrEqual(
      market.supply.lines.find((line) => line.key === 'highQualityMetal')!.capacity,
    );
    expect(market.resources.caps, 'the crew must be able to afford a unit').toBeGreaterThan(1_000);

    await pick(RESOURCE_LABELS.highQualityMetal);
    await waitFor(() => expect(screen.getByTestId('supply-buy')).toHaveTextContent('Store full'));
  });

  it('still says the store is full on the bulk shelf itself', async () => {
    await pick(RESOURCE_LABELS.scrap);
    // Room in scrap, so the run is open: this is the control that the case above is about the
    // shelf and not about the screen refusing everything.
    await waitFor(() => expect(screen.getByTestId('supply-buy')).toHaveTextContent('Buy it'));
  });
});

/*
 * Maintainer, 2026-09-29: the supply run is a shop without a bid, so it shows the one figure the
 * till will take, the crew's market discount already off it.
 */
describe('the supply run after the market discount', () => {
  it('quotes the discounted price, the one the server charges', async () => {
    const discounted: MarketResponse = {
      ...market,
      marketDiscountPercent: 20,
      supply: supplyBoard(
        12,
        resources,
        10_000,
        0,
        (key) => Math.round(10_000 * (STORAGE_SHARES[key] ?? 0)),
        20,
      ),
    };
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market')) return reply(discounted);
      throw new Error(`unstubbed request: ${path}`);
    });
    renderMarket();
    const picker = await screen.findByTestId('supply-resource');
    fireEvent.click(within(picker).getByRole('radio', { name: RESOURCE_LABELS.scrap }));
    await waitFor(() =>
      expect(screen.getByTestId('supply-quote')).toHaveTextContent(
        supplyPrice('scrap', 100, 20).toLocaleString(),
      ),
    );
    expect(supplyPrice('scrap', 100, 20)).toBeLessThan(supplyPrice('scrap', 100));
  });

  it('prints the unit price on each tile, not one unit rounded up', async () => {
    renderMarket();
    const picker = await screen.findByTestId('supply-resource');
    const tile = within(picker).getByRole('radio', { name: RESOURCE_LABELS.scrap });
    const each = supplyUnitPrice('scrap');
    // A fractional price, or this case proves nothing about the rounding.
    expect(Number.isInteger(each)).toBe(false);
    expect(tile).toHaveTextContent(each.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  });
});

/*
 * Bug pass, 2026-10-01: the run's ration is caps' worth, and the header printed it bare beside a
 * field counted in units. It says the units of whatever the picker is on now. The fixture's level
 * 12 crew may buy 52% of a 10,000 store, 5,200 supplies' worth: 7,800 caps of it.
 */
describe('the supply run header', () => {
  it('prints the ration left in units of the picked material, and follows the picker', async () => {
    renderMarket();
    const left = await screen.findByTestId('supply-left');
    // Scrap is the run's opening pick: 7,800 of worth at 2.5 a unit.
    expect(left).toHaveTextContent('3,120 scrap left');
    const picker = screen.getByTestId('supply-resource');
    fireEvent.click(within(picker).getByRole('radio', { name: RESOURCE_LABELS.highQualityMetal }));
    await waitFor(() => expect(left).toHaveTextContent('650 HQ metal left'));
    fireEvent.click(within(picker).getByRole('radio', { name: RESOURCE_LABELS.supplies }));
    await waitFor(() => expect(left).toHaveTextContent('5,200 supplies left'));
  });

  it('says the ration will not stretch to one more of a dear material, rather than blaming caps', async () => {
    // Five caps of worth left: two scrap, and not one metal at twelve.
    const nearlySpent: MarketResponse = {
      ...market,
      supply: supplyBoard(12, resources, 10_000, 7_795, (key) =>
        Math.round(10_000 * (STORAGE_SHARES[key] ?? 0)),
      ),
    };
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market')) return reply(nearlySpent);
      throw new Error(`unstubbed request: ${path}`);
    });
    renderMarket();
    const left = await screen.findByTestId('supply-left');
    expect(left).toHaveTextContent('2 scrap left');
    const picker = screen.getByTestId('supply-resource');
    fireEvent.click(within(picker).getByRole('radio', { name: RESOURCE_LABELS.highQualityMetal }));
    await waitFor(() => expect(left).toHaveTextContent('0 HQ metal left'));
    const buy = screen.getByTestId('supply-buy');
    // Not "Ration spent": two scrap are still to be had (bug pass, 2026-10-02).
    expect(buy).toHaveTextContent('Too dear today');
    expect(buy).not.toHaveTextContent('Ration spent');
    expect(buy.parentElement).toHaveAttribute(
      'data-tip',
      expect.stringContaining('will not stretch to one more'),
    );
  });
});

/*
 * Maintainer, 2026-10-01: the Broker gives and takes caps, at his usual cut on a cap's worth of one.
 */
describe('the Broker and caps', () => {
  const trade = async (give: string, want: string, amount: number) => {
    const giving = await screen.findByTestId('broker-give');
    fireEvent.click(within(giving).getByRole('radio', { name: give }));
    const taking = screen.getByTestId('broker-take');
    fireEvent.click(within(taking).getByRole('radio', { name: want }));
    const field = screen.getByTestId('broker-amount');
    fireEvent.change(field, { target: { value: String(amount) } });
    fireEvent.blur(field);
  };

  it('offers caps on both sides and quotes what comes back', async () => {
    renderMarket();
    await trade(RESOURCE_LABELS.caps, RESOURCE_LABELS.scrap, 100);
    // A hundred caps at half is fifty of worth, twenty scrap.
    await waitFor(() => expect(screen.getByTestId('broker-answer')).toHaveTextContent('20Scrap'));
    await trade(RESOURCE_LABELS.oil, RESOURCE_LABELS.caps, 100);
    // A hundred oil is two hundred caps of worth, and he keeps half.
    await waitFor(() => expect(screen.getByTestId('broker-answer')).toHaveTextContent('100Caps'));
    expect(screen.getByRole('button', { name: 'Trade' })).toBeEnabled();
  });

  it('quotes caps out under the supply run’s price where a deep discount would beat it', async () => {
    // A raw sum no crew reaches: the run sells at 40% of its list, 0.6 of a material's worth,
    // and his quoted 80% back is held to that on a trade into caps and only on one.
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market'))
        return reply({ ...market, barterRate: 0.8, marketDiscountPercent: 1_000_000_000 });
      throw new Error(`unstubbed request: ${path}`);
    });
    renderMarket();
    await trade(RESOURCE_LABELS.oil, RESOURCE_LABELS.caps, 100);
    await waitFor(() => expect(screen.getByTestId('barter-quote')).toHaveTextContent('60% back'));
    expect(screen.getByTestId('broker-answer')).toHaveTextContent('120Caps');
    await trade(RESOURCE_LABELS.oil, RESOURCE_LABELS.scrap, 100);
    await waitFor(() => expect(screen.getByTestId('barter-quote')).toHaveTextContent('80% back'));
  });
});

/*
 * Maintainer, 2026-10-01: the discount is a curve on the summed sources, so the page says the
 * figure the till applies beside the sum of the cards.
 */
describe('the market discount on the Runner’s note', () => {
  const withDiscount = (raw: number) =>
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market')) return reply({ ...market, marketDiscountPercent: raw });
      throw new Error(`unstubbed request: ${path}`);
    });

  it('prints the effective figure and the raw sum it came from', async () => {
    withDiscount(45);
    renderMarket();
    fireEvent.mouseEnter(await screen.findByTestId('info-note'));
    const line = await screen.findByTestId('market-discount');
    expect(line).toHaveTextContent('Your market discount is 26%');
    expect(line).toHaveTextContent('Your sources add up to 45%');
  });

  it('says nothing about a discount the crew does not have', async () => {
    withDiscount(0);
    renderMarket();
    fireEvent.mouseEnter(await screen.findByTestId('info-note'));
    await screen.findByText(/In today at/);
    expect(screen.queryByTestId('market-discount')).toBeNull();
  });
});
