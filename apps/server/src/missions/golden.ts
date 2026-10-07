import {
  mulberry32,
  scaledSpoils,
  seedFrom,
  type MissionOffer,
  type TerritoryEffects,
} from '@frontline/shared';

/**
 * The Bounty Wall (maintainer, 2026-10-06): on the board of a district where the crew holds one,
 * each fight job has a chance of being golden, and a golden job pays more.
 *
 * Rolled off the deal rather than the read: the seed is the board's key and the card's job, the
 * same two that dealt the card (`missionOffers`), so a card is golden on every read of the same
 * board and the next board rolls afresh. The job's id stands in for the slot because the deal
 * sorts its cards by clock before anybody sees them, and a job is dealt at most once per board.
 *
 * The premium is frozen on the mission at launch (`Mission.goldenPercent`), the way the area's
 * premium is, so losing the wall while the crew is out does not re-price the run.
 */

/** The wall's terms on one district's board, or null where the crew holds none there. */
export type GoldenTerms = TerritoryEffects['goldenJobsByDistrict'][string] | null;

export function goldenTermsOn(
  effects: Pick<TerritoryEffects, 'goldenJobsByDistrict'>,
  areaId: string,
): GoldenTerms {
  return effects.goldenJobsByDistrict[areaId] ?? null;
}

/** Whether this card comes up golden: the same answer for the same deal, however often it is asked. */
export function dealtGolden(
  areaId: string,
  boardKey: string,
  templateId: string,
  terms: GoldenTerms,
): boolean {
  if (terms === null || terms.chancePercent <= 0) return false;
  const roll = mulberry32(seedFrom(`deal:${areaId}:${boardKey}:${templateId}:gold`))();
  return roll * 100 < terms.chancePercent;
}

/** The premium a launch freezes for this card: the wall's, or 0 when the card is not golden. */
export function goldenPercentFor(
  effects: Pick<TerritoryEffects, 'goldenJobsByDistrict'>,
  areaId: string,
  boardKey: string,
  template: { id: string; kind: string },
): number {
  if (template.kind !== 'battle') return 0;
  const terms = goldenTermsOn(effects, areaId);
  return dealtGolden(areaId, boardKey, template.id, terms) ? (terms?.rewardPercent ?? 0) : 0;
}

/** The card with its gold on: marked, and every reward line it quotes paid up. */
export function gilded(offer: MissionOffer, goldenPercent: number): MissionOffer {
  if (goldenPercent <= 0) return offer;
  return {
    ...offer,
    golden: true,
    goldenPercent,
    rewards: scaledSpoils(offer.rewards, goldenPercent),
    ...(offer.ledRewards && { ledRewards: scaledSpoils(offer.ledRewards, goldenPercent) }),
  };
}
