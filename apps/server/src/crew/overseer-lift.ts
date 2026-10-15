import {
  MAX_OVERSEER_LIFT,
  chairIsSettled,
  liftedSheet,
  officerIsWorking,
  rightHandLift,
  seatPoints,
  type AttributeLift,
  type Attributes,
  type Commander,
} from '@frontline/shared';

/**
 * The Overseer's sheet as the crew fields it: their own points plus the Right Hand's (§C2b).
 *
 * Its own module because two readers need it and one of them is folded into the other: the crew
 * screen and every officer's lift (`crew/standing.ts`), and the faction cards (`factions/cards.ts`,
 * maintainer 2026-10-15), whose marks the standing fold pays.
 */

/** The Right Hand who lifts the Overseer: seated, out of bed and settled in, with their fit. */
export function seatedRightHand(
  commanders: readonly Commander[],
  now: Date,
): { officer: Commander; points: number } | null {
  const officer = commanders.find(
    (one) => officerIsWorking(one, now) && one.role === 'right_hand' && chairIsSettled(one, now),
  );
  // Their fit is read off their printed sheet: every other lift includes the Right Hand's.
  return officer ? { officer, points: seatPoints(officer.attributes, 'right_hand') } : null;
}

/** The Overseer's sheet lifted by a Right Hand of these points, with the receipt naming them. */
export function overseerReceiptLiftedBy(
  own: Attributes,
  from: string,
  rightHandPoints: number,
): { attributes: Attributes; lift: AttributeLift[] } {
  const flat = rightHandLift(rightHandPoints, MAX_OVERSEER_LIFT);
  return liftedSheet(own, [
    { from, groupFlat: { physical: flat, mental: flat, social: flat, technical: flat } },
  ]);
}

/** The Overseer's sheet as the crew screen prints it, off the crew's officers alone. */
export function overseerSheetAsFielded(
  own: Attributes,
  commanders: readonly Commander[],
  now: Date,
): Attributes {
  const rightHand = seatedRightHand(commanders, now);
  return rightHand
    ? overseerReceiptLiftedBy(own, rightHand.officer.name, rightHand.points).attributes
    : own;
}
