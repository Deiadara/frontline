import {
  PAYROLL_STEP,
  payrollStepCost,
  startingPayroll,
  type Base,
  type PayrollLedger,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../e2e/fixtures';
import { queryKeys } from '../lib/queries';
import { PayrollBookDialog, RaisePayroll } from './Payroll';

/**
 * §H7: the raise control and the window it lives in are one copy, opened from the Bar and from the
 * Nexus (maintainer, 2026-10-01), so the price line and the refusal are decided here once.
 *
 * There is always another expansion, priced in caps at 300 and sixty more each time, so the button
 * is always drawn and the only refusal is a crew short of the caps.
 */

const ledgerWith = (nextStepCost: number, purchasedSteps: number): PayrollLedger => ({
  capacity: 2000,
  committed: 900,
  available: 1100,
  purchasedSteps,
  nextStepCost,
  stepSize: PAYROLL_STEP,
});

function draw(ledger: PayrollLedger, caps: number) {
  const onRaise = vi.fn();
  render(
    <RaisePayroll ledger={ledger} caps={caps} onRaise={onRaise} pending={false} error={null} />,
  );
  return onRaise;
}

describe('buying an expansion of the payroll book', () => {
  it('offers the button at the caps price the server quotes', () => {
    const onRaise = draw(ledgerWith(payrollStepCost(0), 0), 5000);

    const button = screen.getByTestId('increase-payroll');
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('+30');
    expect(button.closest('div')).toHaveTextContent('300 caps, once');
    fireEvent.click(button);
    expect(onRaise).toHaveBeenCalledOnce();
  });

  it('holds the button for a crew short of the caps', () => {
    draw(ledgerWith(payrollStepCost(0), 0), 299);

    expect(screen.getByTestId('increase-payroll')).toBeDisabled();
  });

  /** However much has been bought, there is a button and a price: no last rung, no ceiling. */
  it('keeps selling to a crew that has bought hundreds, sixty dearer each time', () => {
    draw(ledgerWith(payrollStepCost(400), 400), 500_000);

    expect(screen.getByTestId('increase-payroll')).toBeEnabled();
    expect(screen.getByTestId('increase-payroll').closest('div')).toHaveTextContent(
      '24,300 caps, once',
    );
  });
});

const fetchMock = vi.fn();
const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openBook(base: Base) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PayrollBookDialog base={base} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return screen.getByTestId('payroll-dialog');
}

/**
 * The one window (maintainer, 2026-10-01): "Remove the THE NEXUS from that pop up", and payroll is
 * "just caps, not caps / wk".
 */
describe('the payroll book window', () => {
  const book: Base = {
    ...F.base,
    resources: { ...F.base.resources, caps: 1000 },
    economy: {
      ...F.base.economy,
      payroll: { ...startingPayroll(), purchasedSteps: 2, commitments: { a: 120 } },
    },
  };

  it('names the book and not the structure it was opened from', () => {
    const dialog = openBook(book);
    expect(within(dialog).getByRole('heading', { name: 'The payroll book' })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/the nexus/i);
  });

  it('prints the book in plain caps, with what is left to promise', () => {
    const dialog = openBook(book);
    expect(dialog).toHaveTextContent('Committed to officers');
    expect(dialog).toHaveTextContent(/120 \/ [\d,]+ caps/);
    expect(dialog).toHaveTextContent('Left to promise');
    expect(dialog).not.toHaveTextContent(/wk|week/i);
    expect(dialog).not.toHaveTextContent(/slice of this/);
    expect(dialog).toHaveTextContent(`${payrollStepCost(2)} caps, once`);
  });

  it('buys the expansion the window showed', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/bar/payroll')) {
        return reply({ spent: 420, resources: book.resources, payroll: F.bar.payroll });
      }
      return reply({});
    });
    const dialog = openBook(book);
    fireEvent.click(within(dialog).getByTestId('increase-payroll'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => {
          const [path, init] = call as [string, RequestInit | undefined];
          return path.endsWith('/bar/payroll') && init?.body === JSON.stringify({ fromSteps: 2 });
        }),
      ).toBe(true),
    );
  });

  /*
   * Bug pass, 2026-10-06: the window reads the ledger off the crew's standing, which does not poll,
   * and a raise left it showing the old book and the old price for the next step.
   */
  it('reads the book again after a raise', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/bar/payroll')
        ? reply({ spent: 420, resources: book.resources, payroll: F.bar.payroll })
        : new Promise(() => {}),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(queryKeys.crewStanding, { held: true });
    render(
      <QueryClientProvider client={client}>
        <PayrollBookDialog base={book} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    fireEvent.click(within(screen.getByTestId('payroll-dialog')).getByTestId('increase-payroll'));
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.crewStanding)?.isInvalidated).toBe(true),
    );
  });
});
