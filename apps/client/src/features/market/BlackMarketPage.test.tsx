import {
  DEFAULT_CITY_ID,
  blackLotId,
  blackMarketBoard,
  blackMarketPrice,
  findBlackMarketGood,
  nextLotBid,
  type BlackMarketOffer,
  type BlackMarketResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlackMarketPage } from './BlackMarketPage';
import { useSession } from '../../store/session';

/**
 * The back room, now that every slot on the shelf is a lot.
 *
 * Three claims the screen makes on its own and nothing else can: that a card leads with the figure
 * the lot is actually at rather than with a price, that the door's word is where this crew stands
 * on it, and that saying a number goes to `/black-market/bid` naming the slot and what was believed
 * to be standing in it. The fourth is a removal, which is the kind that rots quietly: the infamy
 * box in the corner is gone, and the standing bar across every screen is where that figure lives.
 */

const NOW = '2026-08-12T12:00:00.000Z';
const DAY = '2026-08-12';
const CLOSES = '2026-08-12T21:00:00.000Z';
const CITY_LEVEL = 12;

const slots = blackMarketBoard(DAY, []);

/** One slot's offer, with whoever the case wants standing on its lot. */
function offerFor(
  index: number,
  bids: { username: string; amount: number; yours: boolean }[] = [],
): BlackMarketOffer {
  const slot = slots[index]!;
  const spec = findBlackMarketGood(slot.goodId);
  const reserve = Math.max(1, spec ? blackMarketPrice(spec, CITY_LEVEL) : 1);
  const leading = bids.reduce<(typeof bids)[number] | null>(
    (best, bid) => (best === null || bid.amount > best.amount ? bid : best),
    null,
  );
  return {
    slot,
    affordable: true,
    price: reserve,
    minNotoriety: spec?.minNotoriety ?? 0,
    effect: spec?.effect ?? 'It does something.',
    lot: {
      lotId: blackLotId(DAY, index),
      slotIndex: index,
      closesAt: CLOSES,
      reserve,
      leading:
        leading === null
          ? null
          : { username: leading.username, amount: leading.amount, at: NOW, yours: leading.yours },
      nextBid: nextLotBid(reserve, leading?.amount ?? null),
      bids: bids.map((bid) => ({ ...bid, at: NOW })),
      bidders: bids.length,
      yourBid: bids.find((bid) => bid.yours)?.amount ?? null,
    },
  };
}

const shelf: BlackMarketResponse = {
  day: DAY,
  // Slot 0 untouched, slot 1 with the reader outbid on it, slot 2 led by the reader. One shelf,
  // three standings, so the three words on the door are all on screen at once.
  offers: [
    offerFor(0),
    offerFor(1, [
      { username: 'Rustline', amount: 999_999, yours: false },
      { username: 'You', amount: 900_000, yours: true },
    ]),
    offerFor(2, [{ username: 'You', amount: 888_888, yours: true }]),
    offerFor(3),
    offerFor(4),
  ],
  infamy: 1_000_000,
  takenToday: 0,
  takesPerDay: 1,
  cityLevel: CITY_LEVEL,
  cityId: DEFAULT_CITY_ID,
  cities: [DEFAULT_CITY_ID],
  stash: {},
  refreshesAt: CLOSES,
  serverNow: NOW,
};

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderShelf() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The tab strip is three `NavLink`s, so the page needs a router even though nothing under
          test navigates. */}
      <MemoryRouter initialEntries={['/game/market/black']}>
        <BlackMarketPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/black-market')) return reply(shelf);
    if (path.endsWith('/black-market/bid')) return reply({ blackMarket: shelf });
    if (path.endsWith('/me'))
      return reply({ admin: false, user: null, overseer: null, base: null });
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the shelf as five lots', () => {
  it('shows the figure each lot is at, and the door says where this crew stands', async () => {
    renderShelf();

    const untouched = await screen.findByTestId('black-slot-0');
    // Nobody has bid, so the figure is where the lot opens.
    expect(within(untouched).getByTestId('black-lot-tag-0')).toHaveTextContent(
      shelf.offers[0]!.price.toLocaleString(),
    );
    expect(within(untouched).getByTestId('black-bid-0')).toHaveTextContent('Bid');

    // Somebody else is in front: the card shows their number, not the opening one.
    const outbid = screen.getByTestId('black-slot-1');
    expect(within(outbid).getByTestId('black-lot-tag-1')).toHaveTextContent('999,999');
    expect(within(outbid).getByTestId('black-bid-1')).toHaveTextContent('Raise');

    expect(within(screen.getByTestId('black-slot-2')).getByTestId('black-bid-2')).toHaveTextContent(
      'Your table',
    );
  });

  /**
   * The removal, pinned.
   *
   * The maintainer asked for the infamy box in the corner to go: the standing bar across the top of
   * every screen already carries the figure. A removal nothing asserts is a removal that comes back
   * the next time somebody wants a number on this screen.
   */
  it('does not print the crew’s infamy in the corner', async () => {
    renderShelf();
    await screen.findByTestId('black-slot-0');
    expect(screen.queryByTestId('black-infamy')).toBeNull();
    // And the figure itself is nowhere on the page outside a lot's own numbers.
    expect(screen.queryByText(shelf.infamy.toLocaleString())).toBeNull();
  });

  it('says how many the crew may walk out with, rather than how many it may take', async () => {
    renderShelf();
    expect(await screen.findByTestId('black-allowance')).toHaveTextContent('1 to win tonight');
  });

  it('sends the number, the slot and what was standing in it', async () => {
    renderShelf();
    fireEvent.click(await screen.findByTestId('black-bid-0'));

    const window = await screen.findByTestId('black-lot-window');
    fireEvent.click(within(window).getByTestId('lot-place'));

    await waitFor(() => {
      const bid = fetchMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].endsWith('/black-market/bid'),
      );
      expect(bid, 'the bid never left the browser').toBeDefined();
      expect(JSON.parse((bid![1] as { body: string }).body)).toEqual({
        slotIndex: 0,
        goodId: slots[0]!.goodId,
        amount: shelf.offers[0]!.lot!.nextBid,
        // The room, which a fence bid has to name and a barrow bid does not: a vendor line id
        // already carries its city, and a slot index is 0 to 4 in every one of them.
        city: DEFAULT_CITY_ID,
      });
    });
  });

  it('offers the four quick raises, the big two included', async () => {
    renderShelf();
    fireEvent.click(await screen.findByTestId('black-bid-0'));
    const window = await screen.findByTestId('black-lot-window');

    for (const percent of [5, 10, 50, 100]) {
      expect(
        within(window).getByTestId(`lot-raise-${percent}`),
        `the + ${percent}% step is missing`,
      ).toBeInTheDocument();
    }

    const opening = shelf.offers[0]!.lot!.nextBid;
    fireEvent.click(within(window).getByTestId('lot-raise-100'));
    // Doubled, and inside the ledger, so nothing is clamped in this case.
    expect(within(window).getByTestId('lot-amount')).toHaveValue(String(opening * 2));
  });
});
