import { OFFICER_MARKS, markIndex, type OfficerMark } from '../crew/marks.js';
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
 * The board's rule is a rate rather than a table: **about four pages every seven rotations**, a
 * rotation being the full set of three offers a board shows (maintainer, 2026-09-29: "faster
 * drops"). It was one in seven, and at that rate the catalogue's "first fortnight" was months: a
 * page is one of 258, so an engaged player's first two or three page document landed on day 27 at
 * the median and a Basic unit document in the fifth month. See {@link PAGE_PRIZE_ROTATION_ODDS}.
 *
 * ## What the card may say
 *
 * The **category** and nothing else. A player sizing a run gets to know a Unit Blueprint's Page is
 * on the table; which page it turns out to be is not decided until the crew is home. That is the
 * point of the mechanic: the anticipation is the reward, and a card that named the page would turn
 * a run into a shopping trip.
 *
 * ## Why the roll is per launch and not per card
 *
 * Each launch rolls its own chance off the run's own seed (maintainer, 2026-09-29). The roll was
 * per card, keyed on the board, so a card that paid once paid on every run of it until the board
 * turned over: a district's board is its day, and a crew home by lunch could send the same card
 * again and win a page every time it landed. A second crew at the same level saw the same cards
 * with the same prizes, so one player's find was anybody's. Rolled per launch, no card is worth
 * repeating and nothing about one is worth sharing.
 *
 * The odds are the per-card odds unchanged, so a player's expected pages a day are what the
 * tuning below was set for. A player takes one card of three and the card never said whether it
 * paid, so every launch already paid with probability {@link pagePrizeOdds} of its grade on
 * average: at the middle grade that is (4/7)/3 = 4/21, about 0.19, and an engaged player's 24
 * runs a day at 70% success come home with 24 x 0.19 x 0.7 = 3.2 pages, before and after. What
 * the per-launch roll removes is the correlation between two runs of one card, not any of the
 * mean.
 */

/**
 * Four pages per seven rotations, expressed per launch: about one run in five at the middle grade.
 * A rotation is three launches, one per card the board shows.
 *
 * Set against a page-economy simulation (2026-09-29) of the shipped draws: the mission prize at
 * the middle grade succeeding 70% of the time, the Runner's and the fence's page lots taken on
 * 30% (casual) or 50% of the days they stand, the Reimagining bench spending every spare, forty
 * seeds each. Medians, before (one page per seven rotations, a third of the draws to each
 * category) and after (this rate, categories weighted by their pages):
 *
 * | player (runs a day)  | first 2 to 3 page document | by day 14 | first unit document |
 * | -------------------- | -------------------------- | --------- | ------------------- |
 * | casual (8)           | day 50, now 30             | 0%, 13%   | day 140, now 84     |
 * | engaged (24)         | day 27, now 10             | 20%, 78%  | day 83, now 32      |
 * | automated (72)       | day 11, now 5              | 65%, 100% | day 38, now 12      |
 *
 * And the median day a document is bound for the engaged player, fastest document, median
 * document and slowest, by rarity: Basic 53/112/182 before and 29/52/64 now, Intricate
 * 100/173/217 and 38/72/80, Advanced 101/216/247 and 68/90/97, Masterpiece 191/229/242 and
 * 83/94/101. Three in seven was measured too and put the engaged player's first document on day
 * 15, half of them inside the fortnight, which is the promise missed as often as kept.
 *
 * `PAGE_PRIZE_HARD_LIFT` is what the hardest grade adds, climbing evenly from none at F-
 * (2026-09-28, when easy and hard became twenty one grades), and it is deliberately small: the
 * brief asks for harder work to pay better "but only by a bit", and a lift big enough to farm
 * would make the Market pointless.
 */
export const PAGE_PRIZE_ROTATION_ODDS = 4 / 7;
export const MISSIONS_PER_ROTATION = 3;
export const PAGE_PRIZE_HARD_LIFT = 1.35;

/**
 * How much the grades a crew is dealt lift the average offer above the F- rate.
 *
 * The lift is linear in the grade, so the blend is the lift at the average grade dealt. A crew
 * spends most of its life in the middle of the ladder, and the middle mark lifts by half of
 * {@link PAGE_PRIZE_HARD_LIFT}'s extra. Dividing it back out keeps "four pages every seven
 * rotations" the rate a player in the middle of the game sees; a new crew sees a little less and
 * a crew dealt Mayhem a little more, which is the "only by a bit" the brief asked for.
 */
export const BOARD_DIFFICULTY_BLEND = 1 + (PAGE_PRIZE_HARD_LIFT - 1) / 2;

export const PAGE_PRIZE_BASE_ODDS =
  PAGE_PRIZE_ROTATION_ODDS / MISSIONS_PER_ROTATION / BOARD_DIFFICULTY_BLEND;

/** The odds one launch at this grade carries a page. */
export function pagePrizeOdds(grade: OfficerMark): number {
  const hardness = markIndex(grade) / (OFFICER_MARKS.length - 1);
  return PAGE_PRIZE_BASE_ODDS * (1 + (PAGE_PRIZE_HARD_LIFT - 1) * hardness);
}

/**
 * Whether this launch carries a page, and of which category.
 *
 * Off the run's own seed, which the server draws at the launch and nobody sees before it, so two
 * runs of the same card are two independent rolls. The same seed always answers the same way, so
 * a run can be replayed.
 *
 * `salt` is a server secret (`missions/prize-salt.ts`). This module ships in the client bundle,
 * and a run's seed is not something to rely on staying private for ever: with the salt in the mix,
 * knowing the seed still says nothing about the page.
 */
export function pagePrizeFor(
  salt: string,
  runSeed: number,
  grade: OfficerMark,
): BlueprintCategory | null {
  const seed = seedFrom(`page:${salt}:${runSeed}`);
  // Two independent readings of one hash: the low half decides whether, the high half decides
  // which.
  const roll = (seed % 100_000) / 100_000;
  if (roll >= pagePrizeOdds(grade)) return null;
  return pagePrizeCategory(seed >>> 17);
}

/**
 * The category a paying run carries, weighted by the pages in it (maintainer, 2026-09-29).
 *
 * It was a third each, so the 28 consumable pages shared as many draws as the 132 upgrade pages:
 * a consumable sheet came about four times as often as a unit or upgrade sheet of the same rarity,
 * and the traps' documents always landed first. Weighted by each category's total draw weight,
 * a page's odds depend on its rarity alone, whichever category it is filed under.
 *
 * `bits` is fifteen bits of the run's hash, read as a point in the range rather than by modulus,
 * so no category is favoured by where the range happens to wrap.
 */
export function pagePrizeCategory(bits: number): BlueprintCategory {
  let point = ((bits & 0x7fff) / 0x8000) * CATEGORY_WEIGHT_TOTAL;
  for (const category of BLUEPRINT_CATEGORIES) {
    point -= CATEGORY_WEIGHT[category];
    if (point < 0) return category;
  }
  return BLUEPRINT_CATEGORIES[BLUEPRINT_CATEGORIES.length - 1]!;
}

/**
 * How often a page of each rarity turns up, as a ratio (maintainer, 2026-09-17).
 *
 * Every page used to be equally likely. Rarity was authored on all 258 of them, read by the
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

/** Each category's total draw weight: what {@link pagePrizeCategory} splits the paying runs by. */
const CATEGORY_WEIGHT: Readonly<Record<BlueprintCategory, number>> = Object.fromEntries(
  BLUEPRINT_CATEGORIES.map((category) => [
    category,
    pagesIn(category).reduce((total, page) => total + page.weight, 0),
  ]),
) as Record<BlueprintCategory, number>;
const CATEGORY_WEIGHT_TOTAL = BLUEPRINT_CATEGORIES.reduce(
  (total, category) => total + CATEGORY_WEIGHT[category],
  0,
);

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
