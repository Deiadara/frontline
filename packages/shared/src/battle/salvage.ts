import { softCap } from './soft-cap.js';

/**
 * The salvage refund's one sum and its bend (maintainer, 2026-10-05: "curve to 100%").
 *
 * The Bone Market and the Rendering Shed (12% at level 1, 66% at 10, one in each city), the two
 * salvage rungs and the salvage perks all add on `salvageRefundPercent`, and the sum reached 155% of
 * what the dead cost: losing units paid. The sum now pays in full to the knee and closes on 100%
 * without reaching it, so a refund never returns what was spent and every source still adds a
 * little.
 */
export const SALVAGE_REFUND_KNEE = 50;
export const SALVAGE_REFUND_CEILING = 100;

/** The share of what the dead cost that comes back, from the summed salvage percent. */
export function salvageRefundCut(percent: number): number {
  if (percent <= 0) return 0;
  return softCap(percent, SALVAGE_REFUND_KNEE, SALVAGE_REFUND_CEILING);
}
