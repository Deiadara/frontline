import { randomUUID } from 'node:crypto';
import {
  addItems,
  addToStash,
  averageCityLevel,
  blackMarketBoard,
  blackMarketDay,
  blackMarketEffect,
  blackMarketPrice,
  blackMarketTakesPerDay,
  findBlackMarketGood,
  nextDayBoundary,
  spendInfamy,
  takeRefusal,
  type Base,
  type BlackMarketRefusal,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';

/**
 * The back room, server-side.
 *
 * Two jobs and nothing else: draw the shelf as it currently stands, and settle one purchase. Every
 * rule, what is on the shelf, what it costs, who may take it, lives in `@frontline/shared` so the
 * screen and the server agree without a second copy.
 *
 * There is no refresh job. The shelf is keyed by the Athens calendar date, so tomorrow's shelf
 * exists the moment tomorrow starts: the turnover rows for a new day are simply absent, which reads
 * as generation zero, which is a different five things. The same lazy-settlement rule the rest of
 * the game follows, with the pleasant property that here there is nothing at all to settle.
 */

export interface Shelf {
  day: string;
  response: BlackMarketResponse;
}

/** What the crew has to spend. One place asks the economy for it, so the ledger has one reader. */
function infamyOf(base: Base): number {
  return base.economy.infamy;
}

/**
 * The city's average player level: what the dealer prices and stocks against (board).
 *
 * **Bots excluded.** §A3's rival is a fixture, not a customer, and a city of one real player and
 * one seeded bot would otherwise quote its prices against the halfway point between them. The
 * dealer reads the street; the bot is scenery.
 *
 * Read from the summaries rather than from full base rows: this runs on every read of the shelf,
 * and the only column it needs is the level.
 *
 * Exported because the shelf is not the only thing that reads it: a fight weights the contraband
 * it applies by the same number, and the battle screen has to quote the figure the fight will use.
 * There were two copies of this function and no test that would have noticed them disagreeing.
 */
export function cityLevelFor(repos: Repositories): number {
  return averageCityLevel(
    repos.bases
      .listSummaries()
      .filter((summary) => !summary.isBot)
      .map((summary) => summary.level),
  );
}

/**
 * §A4: the Statue of the Revolutionist takes infamy off what the dealer asks.
 *
 * Capped and floored: standing under nine metres of bronze does not make contraband free, and a
 * price of zero would turn the daily limit into the only gate the black market has.
 */
export const MAX_BLACK_MARKET_DISCOUNT = 50;

export function discountedInfamy(price: number, percent: number): number {
  if (!Number.isFinite(price)) return price;
  const off = Math.min(MAX_BLACK_MARKET_DISCOUNT, Math.max(0, percent));
  return Math.max(1, Math.round(price * (1 - off / 100)));
}

/** The shelf as this crew sees it: the same five things, marked with what they can actually take. */
export function projectBlackMarket(
  repos: Repositories,
  base: Base,
  now: Date,
  zone: string,
): BlackMarketResponse {
  const day = blackMarketDay(now, zone);
  const board = blackMarketBoard(day, repos.blackMarket.generations(day));
  const infamy = infamyOf(base);
  const takenToday = repos.blackMarket.takenOn(base.id, day);
  // §I3: two a day from level 50, one before it. Read once and quoted on the response, so the
  // screen's allowance and the gate below cannot disagree about what this crew is entitled to.
  const takesPerDay = blackMarketTakesPerDay(base.level);
  // The whole shelf is weighted by this, so it is read once for the page rather than per slot.
  const cityLevel = cityLevelFor(repos);
  // §A4, and so is the crew's own discount, for the same reason.
  const discount = standingEffectsFor(repos, base).blackMarketDiscountPercent;

  return {
    day,
    offers: board.map((slot) => {
      const spec = findBlackMarketGood(slot.goodId);
      const price = spec
        ? discountedInfamy(blackMarketPrice(spec, cityLevel), discount)
        : Number.POSITIVE_INFINITY;
      return {
        slot,
        // Affordability folds the daily limit in, because from the button's point of view they are
        // the same question: can I click this. The refusal text still tells the two apart.
        affordable: takenToday < takesPerDay && infamy >= price,
        // Priced and described *here*, because the same weighting is what the door charges. A
        // client that multiplied the catalogue figure itself would be a second copy of the rule.
        price: Number.isFinite(price) ? price : 0,
        effect: spec ? blackMarketEffect(spec, cityLevel) : '',
      };
    }),
    infamy,
    takenToday,
    takesPerDay,
    cityLevel,
    stash: repos.blackMarket.stashFor(base.id),
    refreshesAt: nextDayBoundary(now, zone).toISOString(),
    serverNow: now.toISOString(),
  };
}

export type TakeResult =
  { kind: 'refused'; reason: BlackMarketRefusal } | { kind: 'taken'; base: Base; goodId: string };

/**
 * Taking one thing off the shelf.
 *
 * The order is: check, charge, hand over, then bump the slot. Bumping last matters: the bump is
 * what makes the good disappear for everybody else in the city, so doing it before the charge would
 * let a crew that cannot pay clear a slot other people were looking at.
 *
 * A boost goes to the stash and waits for a fight. Everything else lands in the satchel, which is
 * where the workshop, the lab and the build queue already look for parts and blueprints: a back
 * room with its own parallel inventory would be a second place to check for the same crate.
 */
export function takeFromBlackMarket(
  repos: Repositories,
  base: Base,
  slotIndex: number,
  goodId: string,
  now: Date,
  zone: string,
): TakeResult {
  const day = blackMarketDay(now, zone);
  const board = blackMarketBoard(day, repos.blackMarket.generations(day));
  const cityLevel = cityLevelFor(repos);
  const refusal = takeRefusal({
    slotIndex,
    goodId,
    board,
    infamy: infamyOf(base),
    takenToday: repos.blackMarket.takenOn(base.id, day),
    level: base.level,
    cityLevel,
  });
  if (refusal) return { kind: 'refused', reason: refusal };

  // `takeRefusal` already proved both of these; re-deriving beats threading them out of a guard.
  const spec = findBlackMarketGood(goodId);
  if (!spec) return { kind: 'refused', reason: 'unknown_slot' };
  // The same weighted figure the shelf quoted, from the same function: a screen that offered one
  // price and a door that charged another is the one failure this cannot have.
  const left = spendInfamy(
    infamyOf(base),
    discountedInfamy(
      blackMarketPrice(spec, cityLevel),
      standingEffectsFor(repos, base).blackMarketDiscountPercent,
    ),
  );
  if (left === null) return { kind: 'refused', reason: 'not_enough_infamy' };

  const paid: Base = {
    ...base,
    economy: { ...base.economy, infamy: left },
    inventory: spec.grants ? addItems(base.inventory, spec.grants) : base.inventory,
  };
  repos.bases.updateEconomy(paid.id, paid.economy);
  if (spec.grants) repos.bases.updateHoldings(paid.id, paid.resources, paid.inventory);
  if (spec.boost) {
    repos.blackMarket.writeStash(paid.id, addToStash(repos.blackMarket.stashFor(paid.id), spec.id));
  }

  repos.blackMarket.recordTaking({
    id: randomUUID(),
    baseId: paid.id,
    day,
    slotIndex,
    goodId: spec.id,
    infamySpent: spec.infamy,
    takenAt: now.toISOString(),
  });
  repos.blackMarket.bumpGeneration(day, slotIndex);

  return { kind: 'taken', base: paid, goodId: spec.id };
}
