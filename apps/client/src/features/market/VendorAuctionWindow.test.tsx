import { discountedCaps } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VendorAuctionWindow } from './VendorAuctionWindow';

/**
 * A figure past what the crew can bid (bug pass, 2026-09-29). The barrow said "you have 500 caps,
 * he will want the whole figure" to a crew whose ground takes a cut off the charge, while the table
 * would take a bid of 700 from them: the message was handed the purse and never the ceiling.
 */
const lineId = '2026-09-15-0-optic_cluster';
const offer = {
  line: { id: lineId, item: 'optic_cluster', stock: 1, price: 800 },
  auction: {
    lineId,
    session: 0,
    closesAt: '2026-09-15T14:00:00.000Z',
    reserve: 800,
    leading: null,
    nextBid: 800,
    bids: [],
    bidders: 0,
    yourBid: null,
  },
};

/** The same lot after this crew bid 800 and somebody else went to 900. */
const outbid = {
  ...offer,
  auction: {
    ...offer.auction,
    leading: { username: 'rival', amount: 900, at: '2026-09-15T12:40:00.000Z', yours: false },
    nextBid: 950,
    bidders: 2,
    yourBid: 800,
  },
};

function renderWindow(
  caps: number,
  bidCeiling: number,
  discountPercent?: number,
  shown: typeof offer | typeof outbid = offer,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <VendorAuctionWindow
        offer={shown}
        now={new Date('2026-09-15T13:00:00.000Z')}
        caps={caps}
        bidCeiling={bidCeiling}
        {...(discountPercent === undefined ? {} : { discountPercent })}
        atLotCap={false}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Who is reading only sets the clock face the bid times are printed in; it never answers here.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => undefined)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a bid past what the crew can cover', () => {
  it('names the ceiling when the crew’s ground lifts it past the purse', () => {
    renderWindow(500, 700);
    // On the greyed button's hover, not a line under it (maintainer, 2026-10-06).
    expect(screen.getByTestId('lot-place')).toBeDisabled();
    expect(screen.getByTestId('lot-place').getAttribute('data-tip')).toContain(
      'You can put 500 caps on this lot, which covers a bid of up to 700 once your ground comes off.',
    );
  });

  it('asks for the whole figure when nothing comes off it', () => {
    renderWindow(500, 500);
    expect(screen.getByTestId('lot-place').getAttribute('data-tip')).toContain(
      'a bid takes the whole figure when you place it',
    );
  });

  // Held bids (2026-10-06): a raise hands the crew's 800 back before it takes the new figure.
  it('counts the caps its own outbid bid is holding towards a raise', () => {
    renderWindow(200, 200, undefined, outbid);
    expect(screen.getByTestId('lot-place')).not.toHaveAttribute('data-tip');
    expect(screen.getByTestId('lot-place')).toBeEnabled();
  });
});

/*
 * Maintainer, 2026-09-29: a bid shows what the crew would actually pay beside it, "bid / you pay",
 * and a crew with nothing off shows the bid alone, as it always did.
 */
describe('what a bid would cost this crew', () => {
  it('prints the bid and the figure after the discount', () => {
    renderWindow(10_000, 10_000, 15);
    expect(screen.getByTestId('lot-you-pay')).toHaveTextContent(`/ ${discountedCaps(800, 15)}`);
  });

  it('prints nothing more when nothing comes off', () => {
    renderWindow(10_000, 10_000, 0);
    expect(screen.queryByTestId('lot-you-pay')).toBeNull();
    renderWindow(10_000, 10_000);
    expect(screen.queryByTestId('lot-you-pay')).toBeNull();
  });
});
