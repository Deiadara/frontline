import type { ItemRarity } from '../items/rarity.js';
import { drawWeighted, seedFrom } from '../rng.js';
import {
  BLUEPRINTS,
  BLUEPRINT_CATEGORIES,
  pageRarity,
  type BlueprintCategory,
  type BlueprintPageId,
} from './catalog.js';

/**
 * Pages as mission pay (§F1).
 *
 * The board's rule is a rate rather than a table: **about one page every seven rotations**, a
 * rotation being the full set of three offers a board shows. So a page is a thing a crew notices
 * when it happens rather than a line they plan around, and the whole blueprint economy stays slow
 * enough that the Black Market and the Runner are worth using.
 *
 * ## What the card may say
 *
 * The **category** and nothing else. A player sizing a run gets to know a Unit Blueprint's Page is
 * on the table; which page it turns out to be is not decided until the crew is home. That is the
 * point of the mechanic: the anticipation is the reward, and a card that named the page would turn
 * a run into a shopping trip.
 *
 * ## Why the rate is per offer and not per rotation
 *
 * A board is three offers and a player takes one of them. Rolling the prize per *rotation* would
 * mean the page is attached to a board rather than to a job, so a player could read which of the
 * three carried it and the choice would collapse. Rolled per offer, at a third of the rotation
 * rate, the long run works out the same and no card is a tell.
 */

/**
 * One page per seven rotations, expressed per offer.
 *
 * Seven rotations of three offers is twenty one offers, so the base is 1/21. `PAGE_PRIZE_HARD_LIFT`
 * is what a hard job adds, and it is deliberately small: the brief asks for harder work to pay
 * better "but only by a bit", and a lift big enough to farm would make the Market pointless.
 */
export const PAGE_PRIZE_ROTATION_ODDS = 1 / 7;
export const MISSIONS_PER_ROTATION = 3;
export const PAGE_PRIZE_HARD_LIFT = 1.35;

/**
 * How much the real board's mix of difficulties lifts the average offer above the easy rate.
 *
 * Measured, not assumed: about 71% of the offers the twelve boards actually produce are hard work,
 * so applying {@link PAGE_PRIZE_HARD_LIFT} to that many of them multiplies the blended rate by
 * roughly a quarter. Dividing it back out here is what makes "one page every seven rotations" the
 * rate a **player** sees rather than the rate an all-easy board would have seen. Set the base to a
 * flat `1/21` instead and the measured rate comes out at one per 5.96 rotations, which is 17% more
 * generous than the brief.
 */
export const BOARD_DIFFICULTY_BLEND = 1.25;

export const PAGE_PRIZE_BASE_ODDS =
  PAGE_PRIZE_ROTATION_ODDS / MISSIONS_PER_ROTATION / BOARD_DIFFICULTY_BLEND;

/** The odds one offer of this difficulty carries a page. */
export function pagePrizeOdds(difficulty: 'easy' | 'hard'): number {
  return PAGE_PRIZE_BASE_ODDS * (difficulty === 'hard' ? PAGE_PRIZE_HARD_LIFT : 1);
}

/**
 * Whether this offer carries a page, and of which category.
 *
 * Seeded off the maintainer's own key so the answer is stable for as long as the offer is: a card that
 * re-rolled its prize on every read would be a card a player could refresh until it paid.
 */
export function pagePrizeFor(
  areaId: string,
  day: string,
  templateId: string,
  difficulty: 'easy' | 'hard',
): BlueprintCategory | null {
  const seed = seedFrom(`page:${areaId}:${day}:${templateId}`);
  // Two independent readings of one hash: the low half decides whether, the high half decides
  // which. Drawing both off the same number keeps this a pure function of the offer's identity.
  const roll = (seed % 100_000) / 100_000;
  if (roll >= pagePrizeOdds(difficulty)) return null;
  return BLUEPRINT_CATEGORIES[(seed >>> 17) % BLUEPRINT_CATEGORIES.length]!;
}

/**
 * How often a page of each rarity turns up, as a ratio (maintainer, 2026-09-17).
 *
 * Every page used to be equally likely. Rarity was authored on all 255 of them, read by the
 * Scrapyard for gating and pricing, and ignored by both draws that hand one out, so a Masterpiece
 * page was exactly as common as a Basic one. In the unit category that put the scale *backwards*:
 * six Basic pages against nine Masterpiece ones meant the cheap end was the rare end.
 *
 * ## Why the ladder is this gentle
 *
 * Because a rarer blueprint already costs more pages. A Basic drawing is two or three sheets and a
 * Masterpiece is five to eight, so the two gradients multiply, and the maintainer's brief was
 * "rarer than normal, but not too much, since you need more of them". Modelled over the shipped
 * catalogue as the expected number of page finds to complete one blueprint:
 *
 * | category | Basic | Intricate | Advanced | Masterpiece |
 * | -------- | ----- | --------- | -------- | ----------- |
 * | unit     | 167 to 128 | 198 to 178 | 218 to 225 | 252 to 285 |
 * | upgrade  | 199 to 154 | 241 to 221 | 271 to 311 | 305 to 423 |
 *
 * So the cheap end gets meaningfully quicker, the dear end gets modestly slower, and the spread
 * across the scale goes from 1.5x to about 2.8x. A steeper ladder was measured too: at 8/6/5/3 an
 * upgrade Masterpiece runs to 506, which is the punishing version the brief ruled out.
 *
 * ## Why this is not the salvage ladder
 *
 * `items/salvage.ts` draws components at 0.58/0.28/0.12/0.02, which is a 29x spread, and the
 * Runner's barrow stocks at 5/3/2/1. Both are right for what they are: a component is one find and
 * you use it, while a page is one of several you have to collect before anything happens at all.
 * Steepness that reads as "a lucky day" on a component reads as a wall on a page.
 */
export const PAGE_DRAW_WEIGHT: Readonly<Record<ItemRarity, number>> = {
  basic: 6,
  intricate: 5,
  advanced: 4,
  masterpiece: 3,
};

/**
 * Which page a completed run actually won.
 *
 * Decided on arrival rather than when the card was drawn, so nothing about the offer can be read
 * back to predict it. Duplicates are allowed and are not an accident (§F1d): a spare page is what
 * Reimagining spends, so the same page twice is still worth something.
 */
export function pageWonFrom(
  category: BlueprintCategory,
  seed: string | number,
): BlueprintPageId | null {
  return drawPage(pagesIn(category), `won:${seed}`);
}

/** Every page in a category, each with the rarity it was authored at. */
export function pagesIn(category: BlueprintCategory): { id: BlueprintPageId; weight: number }[] {
  return BLUEPRINTS.filter((blueprint) => blueprint.category === category).flatMap((blueprint) =>
    blueprint.pages.map((page) => ({
      id: page.id,
      // A page may be authored a step above its blueprint (`BlueprintPage.rarity`), which is the
      // one sheet that makes a drawing hard to finish. `pageRarity` is the one copy of that rule,
      // and the Reimagining bench reads the same function, so the two cannot grade a sheet
      // differently.
      weight: PAGE_DRAW_WEIGHT[pageRarity(blueprint, page)],
    })),
  );
}

/**
 * One page out of a weighted pool, off a hash rather than a stream.
 *
 * Seeded the same way the uniform draw it replaces was, so a given seed still answers the same way
 * forever; what changed is only which page a given point in the range lands on. The loop itself is
 * {@link drawWeighted}, which the Reimagining bench draws its output rarity from.
 */
export function drawPage(
  pool: readonly { id: BlueprintPageId; weight: number }[],
  seed: string,
): BlueprintPageId | null {
  return drawWeighted(pool, seed);
}
