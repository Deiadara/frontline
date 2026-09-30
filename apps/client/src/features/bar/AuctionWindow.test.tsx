import { NO_FREE_BED_TEXT, committedWage } from '@frontline/shared';
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
const auction = {
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
  { chairsFree = 3, auctionsUsed = 0, wageDiscountPercent = 0 } = {},
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuctionWindow
        recruit={{ ...recruit, assessment: { ...recruit.assessment, interested: true } }}
        auction={auction}
        now={now}
        bidCeiling={10_000}
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
