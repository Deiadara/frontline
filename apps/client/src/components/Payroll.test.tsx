import {
  PAYROLL_STEP,
  PAYROLL_STEPS_MAX,
  payrollStepCost,
  type PayrollLedger,
} from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RaisePayroll } from './Payroll';

/**
 * §H7: the raise control is the one copy of this button, so it is where the ceiling has to land.
 *
 * The Bar and the Nexus both draw `RaisePayroll` rather than their own, which is why a maxed book
 * is handled here and neither screen needs to know about it. A crew that has bought all 51 rungs
 * has nothing to press, and `POST /bar/payroll` answers `PAYROLL_AT_MAX`: a button that reaches
 * that refusal is a button offering a purchase the server will not make.
 */

const ledgerWith = (nextStepCost: number | null, purchasedSteps: number): PayrollLedger => ({
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
    <RaisePayroll
      ledger={ledger}
      caps={caps}
      onRaise={onRaise}
      pending={false}
      error={null}
      testId="raise"
      showShortfall
    />,
  );
  return onRaise;
}

describe('buying a rung of the payroll ladder', () => {
  it('offers the button at the price the ladder quotes', () => {
    draw(ledgerWith(payrollStepCost(0), 0), 5000);

    expect(screen.getByTestId('raise')).toBeEnabled();
    expect(screen.getByTestId('raise').closest('div')).toHaveTextContent('600 caps, once');
  });

  it('says how far short a crew is rather than pretending the button works', () => {
    draw(ledgerWith(payrollStepCost(0), 0), 450);

    expect(screen.getByTestId('raise')).toBeDisabled();
    expect(screen.getByText(/150 caps short of the next step/)).toBeInTheDocument();
  });

  /**
   * The case the ceiling introduced.
   *
   * No button at all rather than a disabled one. A disabled control says "not yet", and a player
   * reading it goes looking for the caps that would open it; there are none, because there is no
   * rung. The price line is where the answer belongs, because that is the line a player was
   * reading for the price.
   */
  it('takes the button away once the ladder is bought out', () => {
    draw(ledgerWith(null, PAYROLL_STEPS_MAX), 500_000);

    expect(screen.queryByTestId('raise')).toBeNull();
    expect(screen.getByText(/as wide as it goes/)).toBeInTheDocument();
    expect(screen.queryByText(/caps, once/)).toBeNull();
  });

  /** A crew with every cap in the city is still told the ladder is finished, not that they are short. */
  it('never calls a bought-out book a shortfall', () => {
    draw(ledgerWith(null, PAYROLL_STEPS_MAX), 0);

    expect(screen.queryByText(/short of the next step/)).toBeNull();
    expect(screen.getByText(/as wide as it goes/)).toBeInTheDocument();
  });
});
