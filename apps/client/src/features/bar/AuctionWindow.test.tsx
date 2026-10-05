import { NO_FREE_BED_TEXT, committedWage, type BarAuction } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { AuctionWindow } from './AuctionWindow';

/**
 * "Need a free bed" (maintainer, 2026-09-29): an officer sleeps in one, so with the district full
 * the server refuses a bid, and the window greys the control and says why before it is pressed.
 */

const recruit = F.bar.recruits[0]!;
const auction: BarAuction = {
  ...F.bar.auctions[0]!,
  recruitId: recruit.id,
  yourBid: null,
  yourSealed: null,
  leading: null,
};
// A minute before the seal, so the open bid controls are the ones on screen.
const now = new Date(Date.parse(auction.sealedFrom) - 60_000);

function renderWindow(
  bedsFree: number,
  {
    chairsFree = 3,
    auctionsUsed = 0,
    wageDiscountPercent = 0,
    bidCeiling = 10_000,
    table = auction,
  } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuctionWindow
        recruit={{ ...recruit, assessment: { ...recruit.assessment, interested: true } }}
        auction={table}
        now={now}
        bidCeiling={bidCeiling}
        wageDiscountPercent={wageDiscountPercent}
        auctionsUsed={auctionsUsed}
        auctionsAllowed={2}
        chairsFree={chairsFree}
        bedsFree={bedsFree}
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

describe('bidding with every bed taken', () => {
  it('greys the bid and names the bed', () => {
    renderWindow(0);
    expect(screen.getByTestId('place-bid')).toBeDisabled();
    expect(screen.getByTestId('bid-refusal')).toHaveTextContent(NO_FREE_BED_TEXT);
  });

  it('leaves the bid live with a bed to spare', () => {
    renderWindow(1);
    expect(screen.getByTestId('place-bid')).toBeEnabled();
    expect(screen.queryByTestId('bid-refusal')).toBeNull();
  });
});

/*
 * Maintainer, 2026-09-30: a crew holding more officers than its level's slots keeps them all and
 * bids on nobody until it is back under. At the limit and over it are two different sentences,
 * because "let somebody go" is wrong advice to a crew that has to let two go.
 */
describe('bidding with every officer slot taken', () => {
  it('greys the bid and says the books are full at the limit', () => {
    renderWindow(4, { chairsFree: 0 });
    expect(screen.getByTestId('place-bid')).toBeDisabled();
    expect(screen.getByTestId('bid-refusal')).toHaveTextContent('Your books are full');
  });

  it('greys the bid and says everyone stays when the crew is over the limit', () => {
    renderWindow(4, { chairsFree: -2 });
    expect(screen.getByTestId('place-bid')).toBeDisabled();
    const refusal = screen.getByTestId('bid-refusal');
    expect(refusal).toHaveTextContent('more officers than your slots allow');
    expect(refusal).toHaveTextContent('They all stay');
    expect(screen.queryByTestId('chairs-warning')).toBeNull();
  });
});

/**
 * Two tables and room for one: the second win passes at midnight, and the window says so before the
 * bid. It used to count chairs only, so a crew with chairs to spare and one bed heard nothing.
 */
describe('more tables than room to seat the wins', () => {
  it('names the bed when a bed is what runs out', () => {
    renderWindow(1, { chairsFree: 3, auctionsUsed: 1 });
    expect(screen.getByTestId('chairs-warning')).toHaveTextContent('One bed free for 2 tables');
  });

  it('names the chair when a chair is what runs out', () => {
    renderWindow(4, { chairsFree: 1, auctionsUsed: 1 });
    expect(screen.getByTestId('chairs-warning')).toHaveTextContent('One chair free for 2 tables');
  });

  it('says nothing with room for every table', () => {
    renderWindow(2, { chairsFree: 2, auctionsUsed: 1 });
    expect(screen.queryByTestId('chairs-warning')).toBeNull();
  });
});

/*
 * Maintainer, 2026-09-29: the bid and what the book would be charged after the crew's negotiators,
 * "bid / you pay", and the bid alone for a crew with nothing coming off.
 */
describe('what a table would cost this crew', () => {
  it('prints the wage after the negotiators beside the bid', () => {
    renderWindow(2, { wageDiscountPercent: 20 });
    expect(screen.getByTestId('bid-you-pay')).toHaveTextContent(
      `/ ${committedWage(auction.nextBid, 20)}`,
    );
  });

  it('prints nothing more with no negotiators', () => {
    renderWindow(2);
    expect(screen.queryByTestId('bid-you-pay')).toBeNull();
  });
});

/**
 * Wages in plain caps (maintainer, 2026-10-01: "Remove everywhere the per week wording"), and a
 * book too small for the bid points at the Bar's own Increase payroll rather than at the Nexus.
 */
describe('a bid the book cannot hold', () => {
  it('says how much the book holds, in caps, and where to widen it', () => {
    const { container } = renderWindow(4, { bidCeiling: auction.nextBid - 1 });
    expect(screen.getByTestId('place-bid')).toBeDisabled();
    expect(screen.getByTestId('bid-refusal')).toHaveTextContent(
      `Your book holds up to ${(auction.nextBid - 1).toLocaleString()} caps. Increase it at the foot of the Bar.`,
    );
    expect(container.ownerDocument.body).not.toHaveTextContent(/wk|a week/i);
  });
});

/** A reader who never bid on a table somebody else leads has not been outbid: nobody beat them. */
describe('where the reader stands', () => {
  const someoneElse = { username: 'rival', amount: auction.reserve + 50, at: now.toISOString() };

  it('says somebody is in front on a table the reader never bid on', () => {
    renderWindow(2, { table: { ...auction, leading: { ...someoneElse, yours: false } } });
    expect(screen.getByTestId('auction-standing')).toHaveTextContent('Somebody is in front');
  });

  it('says outbid only when the reader has a bid that was beaten', () => {
    renderWindow(2, {
      table: { ...auction, yourBid: auction.reserve, leading: { ...someoneElse, yours: false } },
    });
    expect(screen.getByTestId('auction-standing')).toHaveTextContent('You have been outbid');
  });

  it("says leading when the top bid is the reader's", () => {
    renderWindow(2, {
      table: {
        ...auction,
        yourBid: someoneElse.amount,
        leading: { ...someoneElse, username: 'me', yours: true },
      },
    });
    expect(screen.getByTestId('auction-standing')).toHaveTextContent('You are leading');
  });
});

// Maintainer, 2026-10-04: bids cannot be taken back, and the panel says what a bid holds.
describe('what a bid holds', () => {
  it('offers no way to take a bid back, and says the wage is held until midnight', () => {
    renderWindow(5, { table: { ...auction, yourBid: auction.reserve } });
    expect(screen.queryByTestId('withdraw-bid')).toBeNull();
    expect(screen.getByTestId('bid-holds')).toHaveTextContent('win or lose');
  });
});
