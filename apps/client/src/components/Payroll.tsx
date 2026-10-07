import {
  CENTRAL_BUILDING,
  buildingLevel,
  payrollBonusPercent,
  payrollLedger,
  PAYROLL_STEP_RESOURCE,
  type Base,
  type PayrollLedger,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';
import { PressError } from './ui/PressError';
import { Modal } from './ui/Modal';
import { useCrewStanding, useIncreasePayroll } from '../lib/queries';

/**
 * The payroll book's shared pieces: the meter, the raise control, and the one window that sells an
 * expansion.
 *
 * The window is opened from two places, the Bar's `Increase Payroll` and the Nexus's (maintainer,
 * 2026-10-01: "you can use the exact same pop up window for both"), so it is one component with no
 * variant flag. The meter is also drawn by the Crew screen's payroll line, which is why it is
 * exported on its own: its "full turns red" rule is one fact about one book.
 */

/** How full the book is, 0..100. Zero capacity reads as empty rather than as a division by zero. */
export function payrollPercent(ledger: PayrollLedger): number {
  return ledger.capacity > 0 ? Math.min(100, (ledger.committed / ledger.capacity) * 100) : 0;
}

/**
 * The bar. Red at capacity, because a full book is a refusal waiting to happen.
 *
 * `className` is for the track, and it exists because the track is the one part of this that is
 * about the panel rather than about the book. `bg-surface-950` reads as a groove on the Bar's
 * painted tin; on paper it is within a couple of values of the sheet, so an empty book drew nothing
 * at all and the meter looked like a gap somebody had left. The caller that sits on paper rings it;
 * nothing else has to know.
 */
export function PayrollMeter({ ledger, className }: { ledger: PayrollLedger; className?: string }) {
  const pct = payrollPercent(ledger);
  return (
    <span className={cn('block h-2 w-full overflow-hidden rounded-sm bg-surface-950', className)}>
      <span
        className={cn('block h-full rounded-sm', pct >= 100 ? 'bg-oxblood-300' : 'bg-brass-300')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export interface RaisePayrollProps {
  ledger: PayrollLedger;
  /** Caps in the stockpile (`PAYROLL_STEP_RESOURCE`), for the affordability check. */
  caps: number;
  onRaise: () => void;
  pending: boolean;
  error: string | null;
  /** Padding above the divider. */
  className?: string;
}

/**
 * Buy an expansion of the book: the button and what it costs.
 *
 * There is always another expansion, so there is always a button: the price climbs by sixty caps
 * with every one bought and never stops, and the only refusal left is a crew short of the caps.
 */
export function RaisePayroll({
  ledger,
  caps,
  onRaise,
  pending,
  error,
  className,
}: RaisePayrollProps) {
  const price = ledger.nextStepCost;
  const affordable = caps >= price;
  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2.5 border-t border-surface-700 pt-3',
          className,
        )}
      >
        <Button
          size="sm"
          disabled={!affordable || pending}
          onClick={onRaise}
          data-testid="increase-payroll"
        >
          {pending ? 'Raising…' : `Increase payroll · +${ledger.stepSize}`}
        </Button>
        <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {price.toLocaleString('en-US')} caps, once
        </span>
      </div>
      {error !== null && <PressError>{error}</PressError>}
    </>
  );
}

/** A named figure in the book: the label on the left, the number on the right. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * What the crew may promise officers, and the one control that raises it (§H7).
 *
 * The ceiling comes straight off the base: `payrollCapacity` of the Nexus level, what has been
 * bought and the district's own bonus are all on it, and a second read of those would be a second
 * answer. The step *price* is the exception, and the reason is below.
 */
function PayrollBook({ base }: { base: Base }) {
  const raise = useIncreasePayroll();
  /*
   * The step discount is the one figure in this ledger that is not on the base.
   *
   * `payrollStepDiscountPercent` (§B7) is a crew channel, not a district one, so the base cannot
   * answer it and the default of 0 quoted full price. `POST /bar/payroll` charges
   * `payrollStepCost(steps, payrollStepDiscountPercent)`, so a crew holding `ledger_hand` and
   * `bank_contact` (13% between them) once saw the list price and a disabled button while the route
   * would have taken less.
   *
   * Read off `/overseer/me`, which is where the client already gets the whole `CrewEffects` struct.
   * Before it answers the panel quotes full price; gating the button on the query instead would
   * turn a request that fails into a permanent refusal.
   */
  const standing = useCrewStanding().data;
  const effects = standing?.effects;
  // The server's book first: the Fixer's share is not something the client can work out
  // (2026-10-04). The local one is only the figure while the query is on its way.
  const ledger =
    standing?.payroll ??
    payrollLedger(
      base.economy.payroll,
      buildingLevel(base.buildings, CENTRAL_BUILDING),
      // The Quarters' own book plus what the crew's ground adds (the Printworks held whole,
      // 2026-10-07): `payrollPercent` is the territory's share of the same channel.
      payrollBonusPercent(base.buildings) + (effects?.['payrollPercent'] ?? 0),
      effects?.['payrollStepDiscountPercent'],
    );

  return (
    <div className="flex flex-col gap-2.5" data-testid="payroll-ledger">
      <dl className="flex flex-col gap-2.5">
        <Figure label="Committed to officers">
          <span className="font-display text-sm font-semibold tabular-nums text-ink-100">
            {ledger.committed.toLocaleString('en-US')} / {ledger.capacity.toLocaleString('en-US')}{' '}
            caps
          </span>
        </Figure>
        <Figure label="Left to promise">
          <span className="font-display text-sm font-semibold tabular-nums text-brass-300">
            {ledger.available.toLocaleString('en-US')}
          </span>
        </Figure>
      </dl>
      {/* Ringed, because the track's own colour is a hair off the paper it sits on: an empty book
          drew a gap rather than an empty bar. See the note on `PayrollMeter`. */}
      <PayrollMeter ledger={ledger} className="ring-1 ring-brass-500/30" />
      <RaisePayroll
        ledger={ledger}
        caps={base.resources[PAYROLL_STEP_RESOURCE]}
        onRaise={() => raise.mutate({ fromSteps: base.economy.payroll.purchasedSteps })}
        pending={raise.isPending}
        error={raise.error?.message ?? null}
        className="pt-2.5"
      />
    </div>
  );
}

/**
 * The payroll book in a window of its own, opened off the Bar's and the Nexus's `Increase Payroll`
 * (maintainer, 2026-09-28, and one window for both on 2026-10-01). It carries no eyebrow naming
 * the structure it came from, which is what lets the Bar open it unchanged.
 */
export function PayrollBookDialog({ base, onClose }: { base: Base; onClose: () => void }) {
  return (
    <Modal
      onClose={onClose}
      labelledBy="payroll-dialog-title"
      size="default"
      dismissible
      data-testid="payroll-dialog"
    >
      <div className="relative flex shrink-0 flex-col gap-1.5 px-5 pb-3.5 pt-4">
        <h2 id="payroll-dialog-title" className="font-stamp text-[23px] leading-none text-ink-100">
          The payroll book
        </h2>
        <span aria-hidden className="ink-rule absolute inset-x-5 bottom-0" />
      </div>
      <div className="px-5 pb-5 pt-3.5">
        <PayrollBook base={base} />
      </div>
    </Modal>
  );
}
