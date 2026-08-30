import type { PayrollLedger } from '@frontline/shared';
import { Button } from './ui/Button';
import { cn } from '../lib/cn';

/**
 * The two pieces of the payroll panel that are the same wherever it is drawn.
 *
 * The book appears twice, at the Bar and inside the Nexus, and the two panels are *not* the same
 * panel: one opens on the roster and leads with what is committed, the other is a structure's own
 * readout and leads with a pair of stats. Both were carrying their own copy of the meter and their
 * own copy of the raise control, which is the half that must never diverge: the meter's "full turns
 * red" rule and the step price are the same fact about the same book, and two copies of a fact is
 * one edit away from the Bar saying a crew is at capacity while the Nexus says it is not.
 *
 * So the shared thing is these two, not the panel. Extracting the whole panel would have meant
 * inventing a variant flag to keep two deliberately different layouts alive through one component,
 * which trades a real duplication for a worse abstraction.
 */

/** How full the book is, 0..100. Zero capacity reads as empty rather than as a division by zero. */
export function payrollPercent(ledger: PayrollLedger): number {
  return ledger.capacity > 0 ? Math.min(100, (ledger.committed / ledger.capacity) * 100) : 0;
}

/** The bar. Red at capacity, because a full book is a refusal waiting to happen. */
export function PayrollMeter({ ledger }: { ledger: PayrollLedger }) {
  const pct = payrollPercent(ledger);
  return (
    <span className="block h-2 w-full overflow-hidden rounded-sm bg-surface-950">
      <span
        className={cn('block h-full rounded-sm', pct >= 100 ? 'bg-oxblood-300' : 'bg-brass-300')}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export interface RaisePayrollProps {
  ledger: PayrollLedger;
  /** Caps in the stockpile, for the affordability check and the shortfall line. */
  caps: number;
  onRaise: () => void;
  pending: boolean;
  error: string | null;
  /** Each panel keeps its own handle: two buttons on two screens are two things to a test. */
  testId: string;
  /** The Bar says how far short a crew is; the Nexus panel does not. */
  showShortfall?: boolean;
  /** Padding above the divider, which the two panels set differently. */
  className?: string;
}

/** Buy a step on the book: the button, what it costs, and why it is refused. */
export function RaisePayroll({
  ledger,
  caps,
  onRaise,
  pending,
  error,
  testId,
  showShortfall = false,
  className,
}: RaisePayrollProps) {
  const affordable = caps >= ledger.nextStepCost;
  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2.5 border-t border-surface-700 pt-3',
          className,
        )}
      >
        <Button size="sm" disabled={!affordable || pending} onClick={onRaise} data-testid={testId}>
          {pending ? 'Raising…' : `Increase payroll · +${ledger.stepSize}`}
        </Button>
        <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {ledger.nextStepCost.toLocaleString()} caps, once
        </span>
      </div>
      {showShortfall && !affordable && (
        <p className="font-body text-[12px] leading-snug text-oxblood-300">
          {(ledger.nextStepCost - caps).toLocaleString()} caps short of the next step.
        </p>
      )}
      {error !== null && (
        <p role="alert" className="font-body text-[12px] text-oxblood-300">
          {error}
        </p>
      )}
    </>
  );
}
