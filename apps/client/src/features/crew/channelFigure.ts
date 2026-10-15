import {
  travelSpeedCut,
  MAX_WAGE_DISCOUNT,
  generalMusterCut,
  cohesionWidening,
  musterSpeedAfterTaper,
  type EffectChannel,
} from '@frontline/shared';

/** `CrewStandingResponse`'s spent figures, for the two cards whose channel cannot say them. */
export interface SpentFigures {
  /** The defence figure the fight spends, Gate in and tapered. */
  heldDefensePercent?: number;
  /** Every medic point a win is recovered on: people, ground and the Infirmary. */
  medicPoints?: number;
}

/**
 * What a channel's sum is actually worth, where the game spends it through a curve or a stop
 * (maintainer ruling P7-A, 2026-10-02). The joined channels (research, build speed, build cost)
 * print as points instead, off their labels, because what they are worth depends on the structure
 * they are added to.
 */
export function channelFigure(
  channel: EffectChannel,
  amount: number,
  /** The figures the server works out because the raw channel cannot say them. */
  spent: SpentFigures = {},
): number {
  switch (channel) {
    // The fight bends the sum together with the Gate (`heldDefense`), so the raw channel alone can
    // say neither the figure nor its direction: the server sends the spent figure (2026-10-13).
    case 'defensePercent':
      return spent.heldDefensePercent ?? amount;
    // The people's points alone said nothing of the Infirmary's or the ground's: the card prints
    // every point a win is recovered on (`medicPointsOf`, maintainer 2026-10-15).
    case 'casualtyRecoveryPercent':
      return spent.medicPoints ?? amount;
    // The contract never takes more than half off (`committedWage`), and a late crew's raw sum
    // reaches 119, which this card used to print as "+119%".
    case 'wageDiscountPercent':
      return Math.min(MAX_WAGE_DISCOUNT, Math.max(0, amount));
    // Half price is as cheap as a unit gets (`generalMusterCut`): the bill stops at 50 on every
    // line, so a raw sum past it printed a cut no muster ever took.
    case 'musterCostPercent':
      return generalMusterCut(amount);
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
