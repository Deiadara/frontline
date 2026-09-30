import {
  DEFAULT_CITY_ID,
  NO_TRADER_TEXT,
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
import { OffersPage } from './OffersPage';
import { useSession } from '../../store/session';

/**
 * The board's one arithmetic claim: whether a deal is good for *you*.
 *
 * Both halves of this page price a trade, and the objects they price arrive with opposite
 * meanings. A listing's `give` is what the other crew hands over, so it is what you receive; the
 * composer's field called `give` is what leaves your own store. Feed the second one into a badge
 * written for the first and the screen congratulates a player for proposing a deal that robs them,
 * which is a worse failure than printing nothing at all.
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
  cityId: DEFAULT_CITY_ID,
  cities: [DEFAULT_CITY_ID],
  caps: resources.caps,
  resources,
  inventory: {},
  // The Runner is not on this page at all, so he is away and his barrow is empty. The response
  // still has to parse, or the page never gets past its loading line.
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

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderOffers() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The tab strip is three `NavLink`s, so the page needs a router even though nothing under
          test navigates. */}
      <MemoryRouter initialEntries={['/game/market/offers']}>
        <OffersPage />
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
 * A counter says whose listing it is answering.
 *
 * The composer is in the other half of the page from the card that was clicked, so a form headed
 * "Counter" is a form that has forgotten which of four listings it is aimed at: the only place the
 * seller's name exists is on the card the player has just stopped looking at. The way back out has
 * to be on the form too, or the only route from a counter to a public listing is a reload.
 */
describe('countering somebody', () => {
  it('names the crew on the form, and hands back a plain listing when you back out', async () => {
    renderOffers();

    // The precondition: the form is the public one before anything is countered.
    expect(await screen.findByText('Put something up')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Counter' }));
    expect(screen.getByText('Countering The Kettle Row Combine')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send the counter' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }));
    expect(screen.getByText('Put something up')).toBeVisible();
    expect(screen.queryByText(/Countering/)).toBeNull();
  });
});

/**
 * Your own listing is priced from your side of the table, which is the other side.
 *
 * The card is the same card in both halves of the page, and the bundle it prices is not: on
 * somebody else's listing `give` is what arrives, and on your own it is what already left your
 * store. The half that reused the board's pairing told a crew that the deal it was giving away was
 * in its favour. The fixture below is the same lopsided trade as the public one above, so a card
 * that reads it the board's way says the opposite of what it must.
 */
describe('a listing of your own', () => {
  beforeEach(() => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market'))
        return reply({ ...market, offers: [], mine: [{ ...market.offers[0], id: 'offer-mine' }] });
      throw new Error(`unstubbed request: ${path}`);
    });
  });

  it('lets a standing listing be taken back', async () => {
    renderOffers();
    await screen.findByTestId('offer-offer-mine');
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled();
    // No verdict on a card any more (maintainer request, 2026-09-09): the piles say what the deal is.
    expect(screen.queryByText('steep')).toBeNull();
    expect(screen.queryByText('in your favour')).toBeNull();
  });
});

/**
 * A posted offer leaves the composer, because posting it spent the goods.
 *
 * `market/board.ts`'s `postOffer` escrows `give` out of the stockpile the moment the listing goes
 * up, on purpose: a board of listings that cannot be honoured is worse than no board. The form kept
 * the pile and re-enabled its button, so a second press escrowed a second copy, up to
 * `MAX_OPEN_OFFERS = 8` of them. The counter case was quieter: `onDone` cleared the target and not
 * the bundle, so the same-looking form turned from "counter that listing" into "public listing".
 */
describe('a half-written listing', () => {
  it('cannot be posted until it both gives and asks for something', async () => {
    renderOffers();
    await screen.findByTestId('offer-give');

    fireEvent.click(screen.getByTestId('offer-give-oil'));
    fireEvent.change(screen.getByTestId('offer-give-amount-oil'), { target: { value: '400' } });
    expect(screen.getByRole('button', { name: 'Post it' })).toBeDisabled();

    fireEvent.click(screen.getByTestId('offer-want-scrap'));
    fireEvent.change(screen.getByTestId('offer-want-amount-scrap'), { target: { value: '400' } });
    expect(screen.getByRole('button', { name: 'Post it' })).toBeEnabled();
  });
});

/**
 * "Need the officer seated" (maintainer, 2026-09-29): with nobody fit in the Trader's chair the
 * server refuses a post, a counter and an accept, so the page says why and greys those three
 * before they are pressed. Withdraw stays live: what is already up is still yours to take back.
 */
describe('with no Trader at work', () => {
  beforeEach(() => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market'))
        return reply({
          ...market,
          traderAtWork: false,
          mine: [{ ...market.offers[0], id: 'offer-mine' }],
        });
      throw new Error(`unstubbed request: ${path}`);
    });
  });

  it('says why, and shuts every new deal while leaving a standing one to withdraw', async () => {
    renderOffers();
    expect(await screen.findByTestId('offers-shut')).toHaveTextContent(NO_TRADER_TEXT);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Counter' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeEnabled();

    // A form that gives and asks, which the test above shows is otherwise live.
    fireEvent.click(screen.getByTestId('offer-give-oil'));
    fireEvent.change(screen.getByTestId('offer-give-amount-oil'), { target: { value: '400' } });
    fireEvent.click(screen.getByTestId('offer-want-scrap'));
    fireEvent.change(screen.getByTestId('offer-want-amount-scrap'), { target: { value: '400' } });
    expect(screen.getByRole('button', { name: 'Post it' })).toBeDisabled();
  });
});

describe('after a listing is posted', () => {
  it('empties the composer rather than leaving a second press armed', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market/offer')) return reply({ market });
      if (path.endsWith('/market')) return reply(market);
      throw new Error(`unstubbed request: ${path}`);
    });

    renderOffers();
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

/**
 * Each city has its own board (maintainer, 2026-09-29). A listing goes up on the tab it was posted
 * from, and a crew's own listings are all listed wherever they stand, so Withdraw can reach one in
 * another city; that card says which board it is on.
 */
describe('a board of one city', () => {
  const terminus = {
    ...market,
    cityId: 'terminus',
    cities: ['ashfall', 'terminus'],
    offers: [],
    mine: [
      { ...market.offers[0], id: 'mine-here', cityId: 'terminus' },
      { ...market.offers[0], id: 'mine-there', cityId: 'ashfall' },
    ],
  };

  it('posts on the city on screen and names the board a listing elsewhere is on', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market/offer')) return reply({ market: terminus });
      if (path.includes('/market')) return reply(terminus);
      throw new Error(`unstubbed request: ${path}`);
    });
    renderOffers();
    await screen.findByTestId('offer-mine-there');

    expect(screen.getByTestId('offer-city-mine-there')).toHaveTextContent('On the Ashfall board');
    expect(screen.queryByTestId('offer-city-mine-here')).toBeNull();

    fireEvent.click(screen.getByTestId('offer-give-oil'));
    fireEvent.change(screen.getByTestId('offer-give-amount-oil'), { target: { value: '400' } });
    fireEvent.click(screen.getByTestId('offer-want-scrap'));
    fireEvent.change(screen.getByTestId('offer-want-amount-scrap'), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post it' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/market/offer'))).toBe(
        true,
      ),
    );
    const post = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/market/offer'));
    if (!post) throw new Error('no offer was posted');
    expect(JSON.parse((post[1] as RequestInit).body as string)).toMatchObject({
      cityId: 'terminus',
    });
  });
});

/**
 * A refusal belongs under the half whose button was pressed.
 *
 * The two writes on this page sit in opposite panels: Accept is on somebody else's listing on the
 * left, Withdraw on your own on the right. Both refusals printed under the left one, because the
 * page took `accept.error ?? withdraw.error` and rendered it there. So "that listing has gone"
 * for a withdraw appeared at the foot of a board the player was not looking at, on a page whose
 * two halves are a full screen apart at 1440.
 *
 * Anchored on the panel headings rather than on a test id, because the panels do not have one and
 * the point of the assertion is *which half of the page* the sentence lands in.
 */
describe('a refused withdraw', () => {
  it('says so under your own half of the board, not under theirs', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market/withdraw'))
        return Promise.resolve({
          headers: new Headers(),
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: () =>
            Promise.resolve({
              error: { code: 'MARKET_REFUSED', message: 'That listing has gone' },
            }),
        } as Response);
      if (path.endsWith('/market'))
        return reply({ ...market, offers: [], mine: [{ ...market.offers[0], id: 'offer-mine' }] });
      throw new Error(`unstubbed request: ${path}`);
    });

    renderOffers();
    await screen.findByTestId('offer-offer-mine');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That listing has gone');
    // `Your Offers` and `District Offers` are the two panel headings; the alert has to be inside the
    // first and not the second.
    const mine = screen.getByRole('heading', { name: 'Your Offers' }).closest('div');
    const theirs = screen.getByRole('heading', { name: 'District Offers' }).closest('div');
    expect(mine?.parentElement?.contains(alert)).toBe(true);
    expect(theirs?.parentElement?.contains(alert)).toBe(false);
  });
});

/**
 * A listing somebody took waits with Claim where Withdraw was (maintainer, 2026-09-28), and the
 * press sends that claim and nothing else.
 */
describe('goods waiting on the board', () => {
  const held: MarketResponse['claims'][number] = {
    id: 'claim-1',
    offer: {
      id: 'offer-sold',
      sellerBaseId: 'base-1',
      sellerName: 'Us',
      give: { resources: { oil: 1_500 }, items: {} },
      want: { resources: { caps: 2_500 }, items: {} },
      status: 'accepted',
      counterTo: null,
      directedAt: null,
      cityId: 'ashfall',
      createdAt: NOW,
    },
    reason: 'taken',
    goods: { resources: { caps: 2_500 }, items: {} },
    takenBy: 'Sisters of the Undergrid',
    createdAt: NOW,
    claimUntil: new Date(Date.parse(NOW) + 19 * 3_600_000).toISOString(),
  };

  it('says who took it and how long is left, and claims it on the press', async () => {
    let claimed = false;
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/market')) return reply({ ...market, claims: claimed ? [] : [held] });
      if (path.endsWith('/market/claim')) {
        expect(JSON.parse(init?.body as string)).toEqual({ claimId: 'claim-1' });
        claimed = true;
        return reply({ market });
      }
      throw new Error(`unstubbed request: ${path}`);
    });
    renderOffers();

    const card = await screen.findByTestId('market-claim-claim-1');
    expect(card).toHaveTextContent('Taken by Sisters of the Undergrid');
    expect(card).toHaveTextContent('You handed over');
    expect(card).toHaveTextContent(/Claim within 19h/);

    fireEvent.click(screen.getByTestId('claim-claim-1'));
    await waitFor(() => expect(screen.queryByTestId('market-claim-claim-1')).toBeNull());
  });

  // Bug pass, 2026-09-29: a listing closed because a reply further down its chain was taken.
  it('says a deal on a counter closed a listing, rather than that it was countered', async () => {
    const closed: MarketResponse['claims'][number] = {
      ...held,
      id: 'claim-2',
      offer: { ...held.offer, status: 'withdrawn' },
      reason: 'closed',
      goods: held.offer.give,
      takenBy: null,
    };
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/market')) return reply({ ...market, claims: [closed] });
      throw new Error(`unstubbed request: ${path}`);
    });
    renderOffers();

    const card = await screen.findByTestId('market-claim-claim-2');
    expect(card).toHaveTextContent('A deal on a counter closed it');
    expect(card).toHaveTextContent('Back to you');
  });
});
