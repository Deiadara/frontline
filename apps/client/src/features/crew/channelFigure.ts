import {
  travelSpeedCut,
  MAX_WAGE_DISCOUNT,
  cohesionWidening,
  musterSpeedAfterTaper,
  type EffectChannel,
} from '@frontline/shared';

/**
 * What a channel's sum is actually worth, where the game spends it through a curve or a stop
 * (maintainer ruling P7-A, 2026-10-02). The joined channels (research, build speed, build cost)
 * print as points instead, off their labels, because what they are worth depends on the structure
 * they are added to.
 */
export function channelFigure(channel: EffectChannel, amount: number): number {
  switch (channel) {
    // The contract never takes more than half off (`committedWage`), and a late crew's raw sum
    // reaches 119, which this card used to print as "+119%".
    case 'wageDiscountPercent':
      return Math.min(amount, MAX_WAGE_DISCOUNT);
    // Tapered towards 80 (`musterSpeedAfterTaper`): a raw +87 is about +72.
    case 'musterSpeedPercent':
      return musterSpeedAfterTaper(amount);
    // Curved towards 65 (`cohesionWidening`).
    case 'cohesionPercent':
      return cohesionWidening(amount);
    // Bent under 75 (`travelSpeedCut`, 2026-10-05): a road always keeps a quarter.
    case 'travelSpeedPercent':
      return travelSpeedCut(amount);
    default:
      return amount;
  }
}
