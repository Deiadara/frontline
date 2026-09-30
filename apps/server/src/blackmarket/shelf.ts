import { randomUUID } from 'node:crypto';
import { tallyContrabandTaken, tallyPagesIn } from '../feats/tally.js';
import {
  MAX_BLACK_MARKET_DISCOUNT,
  addItems,
  addToStash,
  alreadyKnown,
  blackBidRefusal,
  blackLotId,
  blackLotReserve,
  blackLotSeed,
  blackMarketBoard,
  blackMarketClosesAt,
  blackMarketDay,
  blackMarketEffect,
  blackMarketTakesPerDay,
  cityOfBlackLot,
  DEFAULT_CITY_ID,
  findBlackMarketGood,
  largestBidWithin,
  nextDayBoundary,
  rankLotBids,
  spendInfamy,
  discountedInfamy,
  type Base,
  type BlackMarketGoodSpec,
  type BlackMarketRefusal,
  type BlackMarketResponse,
  type BlackMarketSlot,
} from '@frontline/shared';
import type { BlackBid } from '../db/repos/blackmarket.js';
import type { Repositories } from '../db/repos/index.js';
import { calibreOf, citiesFor } from '../city/stakes.js';
import { standingEffectsFor } from '../crew/standing.js';
import { missedLotTitle, outcomeAgainst } from '../bar/auction.js';
import { bidderNames, projectLotAuction } from '../market/auction.js';
import { notify } from '../social/notify.js';
import { tellPagesFound } from '../social/pages.js';
import { settleEach } from '../world/guard.js';

/**
 * The back room, server-side.
 *
 * Three jobs and nothing else: draw the shelf as it currently stands, take a bid on one of its
 * lots, and close the lots whose day is over. Every rule, what is on the shelf, what it opens at,
 * who may bid on it, lives in `@frontline/shared` so the screen and the server agree without a
 * second copy, and the auction itself is the Runner's: `projectLotAuction` and `rankLotBids` are
 * the same functions the barrow settles with.
 *
 * ## The close is not a scheduled job
 *
 * `settleBlackMarketLots` looks for lots with bids and no result row whose day is over, so the
 * close happens on the next read of the shelf. The tie-break is a hash of the lot and the crew
 * rather than a draw from a stream, so it does not matter how often it runs or which door ran it,
 * and the result row is what stops a lot handing out a second crate.
 *
 * There is no refresh job either. The shelf is keyed by the Athens calendar date, so tomorrow's
 * shelf exists the moment tomorrow starts: the turnover rows for a new day are simply absent, which
 * reads as generation zero, which is a different five things.
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
 * What the dealer prices and stocks against: the standing of the crews with a stake in *this* city.
 *
 * It used to be the flat average level of every non-bot base in the world, which was one number for
 * every back room there is: the fence in Terminus quoted Ashfall's street, and a crew holding half
 * of Terminus had no more say over its shelf than somebody who has never been. The Bar was moved
 * off that pattern onto `calibreOf` and this is the same move, so both of a city's counters read
 * one number (`city/access.ts`): a resident counts for a whole share, a visitor for the share of
 * ten locations they hold, and the notoriety ladder counts alongside the district level.
 *
 * Bots are counted now, where the world average excluded them. That is `calibreOf`'s ruling and the
 * right one for a room: a bot holds ground and is somebody to fight, and a city whose only other
 * crews are rivals is exactly the city whose shelf should reflect them.
 *
 * It moves the price and nothing else: a crate does what its card says in every city (maintainer,
 * 2026-09-29), so no fight and no fight screen reads it any more.
 */
export function cityLevelFor(repos: Repositories, cityId: string = DEFAULT_CITY_ID): number {
  return calibreOf(repos, cityId);
}

/** The shelf as this crew sees it: the same five lots, marked with what they can actually bid on. */
export function projectBlackMarket(
  repos: Repositories,
  base: Base,
  now: Date,
  zone: string,
  /** Whose back room (maintainer, 2026-09-17). Defaults to the open city, like the barrow's. */
  cityId: string = DEFAULT_CITY_ID,
): BlackMarketResponse {
  const day = blackMarketDay(now, zone);
  const board = blackMarketBoard(day, repos.blackMarket.generations(day, cityId), cityId);
  const infamy = infamyOf(base);
  const takenToday = repos.blackMarket.takenOn(base.id, day);
  // §I3: two a day from level 50, one before it. Read once and quoted on the response, so the
  // screen's allowance and the close cannot disagree about what this crew is entitled to.
  const takesPerDay = blackMarketTakesPerDay(base.level);
  // The whole shelf is weighted by this, so it is read once for the page rather than per slot.
  const cityLevel = cityLevelFor(repos, cityId);
  // §A4, and so is the crew's own discount, for the same reason.
  const discount = standingEffectsFor(repos, base).blackMarketDiscountPercent;
  // One query for the whole shelf, and one name lookup per crew on it: five lots read separately
  // would be five round trips for a page that is always drawn as a whole.
  const bids = repos.blackMarket.bidsOn(day);
  const names = bidderNames(repos, bids);
  const closesAt = blackMarketClosesAt(day, zone);

  return {
    day,
    offers: board.map((slot) => {
      const spec = findBlackMarketGood(slot.goodId);
      const reserve = spec ? blackLotReserve(spec, cityLevel) : Number.POSITIVE_INFINITY;
      const lotId = blackLotId(day, slot.index, cityId);
      const onThisLot = bids.filter((bid) => bid.lotId === lotId);
      const known = spec !== undefined && alreadyKnown(spec, base.inventory);
      const lot =
        spec === undefined
          ? null
          : {
              lotId,
              slotIndex: slot.index,
              ...projectLotAuction({
                reader: base.ownerId,
                bids: onThisLot,
                reserve,
                closesAt,
                usernames: names,
              }),
            };
      return {
        slot,
        /*
         * Whether this crew can say a number on this lot at all.
         *
         * Three questions folded into one, because from the control's point of view there is one:
         * can I press this. §D7's rank, the purse against what the next legal bid would cost after
         * this crew's standing, and whether they are already the one in front. `blackBidRefusal`
         * still tells them apart in words, so a crew short of a rank is told that and not that
         * they are short of infamy, which is a number they would go and earn for nothing.
         *
         * The daily limit is **not** in here. A crew may bid on all five; what the allowance
         * governs is how many it may win at the close, which is the note on the panel's head.
         */
        affordable:
          lot !== null &&
          lot.leading?.yours !== true &&
          !known &&
          base.economy.notoriety >= (spec?.minNotoriety ?? 0) &&
          infamy >= discountedInfamy(lot.nextBid, discount),
        /** The rank the fence wants, so the shelf can say why rather than just refusing. */
        minNotoriety: spec?.minNotoriety ?? 0,
        alreadyKnown: known,
        // Where the lot opens, weighted *here*, because the same weighting is the floor the close
        // ranks against. A client that multiplied the catalogue figure itself would be a second
        // copy of the rule.
        price: Number.isFinite(reserve) ? reserve : 0,
        effect: spec ? blackMarketEffect(spec) : '',
        lot,
      };
    }),
    infamy,
    // The edge `blackBidRefusal` refuses at: the bid whose charge after this crew's standing is
    // the last one the ledger covers. The card's `affordable` reads the same discount.
    bidCeiling: largestBidWithin(infamy, (bid) => discountedInfamy(bid, discount)),
    discountPercent: Math.min(MAX_BLACK_MARKET_DISCOUNT, Math.max(0, discount)),
    takenToday,
    takesPerDay,
    cityLevel,
    cityId,
    cities: citiesFor(repos, base),
    stash: repos.blackMarket.stashFor(base.id),
    refreshesAt: nextDayBoundary(now, zone).toISOString(),
    serverNow: now.toISOString(),
  };
}

// --- taking a bid ---

export type BlackBidResult = { kind: 'refused'; reason: BlackMarketRefusal } | { kind: 'placed' };

export interface BlackBidCommand {
  base: Base;
  userId: string;
  slotIndex: number;
  /** What the player believed was in the slot, so a shelf that turned over is refused. */
  goodId: string;
  /** Infamy. Rounded on the way in: the wire is an integer and so is the ledger. */
  amount: number;
  now: Date;
  zone: string;
  /** Whose back room the bid is placed in. The route has already checked the crew may stand here. */
  cityId?: string;
}

/**
 * A public bid on one of the fence's lots.
 *
 * Nothing is escrowed and nothing changes hands: the row is a position, and `settleBlackMarketLots`
 * is what turns the highest one into a crate at midnight. Every judgement is `blackBidRefusal`'s,
 * which is shared, so the control that lit up and the door that refuses are reading one rule.
 */
export function placeBlackMarketBid(repos: Repositories, command: BlackBidCommand): BlackBidResult {
  const { base, userId, slotIndex, goodId, now, zone } = command;
  const cityId = command.cityId ?? DEFAULT_CITY_ID;
  const amount = Math.round(command.amount);
  const day = blackMarketDay(now, zone);
  const board = blackMarketBoard(day, repos.blackMarket.generations(day, cityId), cityId);
  const lotId = blackLotId(day, slotIndex, cityId);
  const bids = repos.blackMarket.bidsFor(day, lotId);
  const leader = bids.reduce<BlackBid | undefined>(
    (best, bid) => (best === undefined || bid.amount > best.amount ? bid : best),
    undefined,
  );

  const refusal = blackBidRefusal({
    slotIndex,
    goodId,
    board,
    amount,
    infamy: infamyOf(base),
    cityLevel: cityLevelFor(repos, cityId),
    leading: leader?.amount ?? null,
    leadingIsYou: leader?.userId === userId,
    discountPercent: standingEffectsFor(repos, base).blackMarketDiscountPercent,
    notoriety: base.economy.notoriety,
    inventory: base.inventory,
    /*
     * §H7a on the shelf (maintainer, 2026-09-17): two lots at once.
     *
     * Read off the night's whole bid table rather than a count of this crew's, because the guard
     * needs the lots and not the number: raising on a crate this crew is already in is not a new
     * lot. One read, which is the same read the leader above came from in spirit.
     *
     * **Lot ids, not slot indices.** `bidsOn(day)` is the whole world's night and a slot index is
     * 0 to 4 in every city, so counting by slot made Ashfall's slot 3 and Terminus's slot 3 one
     * lot and Ashfall's slot 1 and Terminus's slot 2 two. The id names the room as well as the
     * slot (`blackLotId`), which is the identity the limit is actually about.
     *
     * **Per city** (maintainer ruling, 2026-09-24). The count spanned every back room at first, on
     * the argument that the infamy being staked is one ledger. The Bar's table cap and the barrow's
     * lot cap both went per city in the same pass, and three rooms in one city obeying two
     * different rules is a thing a player has to learn rather than a thing they can reason about.
     * The one allowance that stays genuinely world-wide is the daily infamy spend
     * (`black_market_takings`), which was ruled that way on purpose: walking to a second city is
     * not a second helping. How many crates you can have an eye on at once is a different question
     * and it is asked per room.
     */
    lotId,
    openLots: repos.blackMarket
      .bidsOn(day)
      .filter((bid) => bid.userId === userId && cityOfBlackLot(bid.lotId) === cityId)
      .map((bid) => bid.lotId),
  });
  if (refusal) return { kind: 'refused', reason: refusal };

  repos.blackMarket.placeBid({
    day,
    lotId,
    slotIndex,
    userId,
    baseId: base.id,
    amount,
    at: now.toISOString(),
  });
  return { kind: 'placed' };
}

// --- the close ---

/** What a lot went for, and who took it. The price is the bid, not what their standing cut it to. */
interface BlackLotWinner {
  userId: string;
  price: number;
}

/** Who took a crate, and the ranking the close walked to find them, which the bells read. */
interface BlackLotAward {
  winner: BlackLotWinner | null;
  ranked: readonly { userId: string }[];
}

/**
 * Closes every lot whose day is over.
 *
 * One transaction per lot, and the result row is written inside it. Those two facts are the whole
 * of the safety argument: a crash between handing over the crate and recording the close would
 * otherwise leave the lot due again, and the second pass would hand out a second one.
 *
 * The lots are walked in slot order, which matters: the allowance is counted off rows earlier
 * closes have already written, so a crew leading three lots takes the first one it is allowed and
 * the other two fall to whoever is behind them.
 */
export function settleBlackMarketLots(repos: Repositories, now: Date, zone: string): number {
  return settleEach(
    repos,
    'black market lots',
    repos.blackMarket.unsettled(now),
    (lot) => `${lot.day}:${lot.lotId}:${lot.slotIndex}`,
    (lot) => closeBlackLot(repos, lot, now, zone),
  );
}

function closeBlackLot(
  repos: Repositories,
  lot: { day: string; lotId: string; slotIndex: number },
  now: Date,
  zone: string,
): void {
  const { day, lotId, slotIndex } = lot;
  // What the bells are dated: the lot closed at midnight, whenever the tick got to it.
  const closedAt = blackMarketClosesAt(day, zone);
  /*
   * Read back off the id rather than stored beside it.
   *
   * The close works from `black_market_bids` and `black_market_lot_results`, both keyed on the lot
   * id, and the id is the only thing in either row that says which room the lot stood in. Adding a
   * column would be a second copy of a fact the key already carries, and a second copy is a thing
   * that can disagree with the key it is filed under.
   */
  const cityId = cityOfBlackLot(lotId);
  const board = blackMarketBoard(day, repos.blackMarket.generations(day, cityId), cityId);
  const slot = board.find((entry) => entry.index === slotIndex);
  const spec = slot ? findBlackMarketGood(slot.goodId) : undefined;
  const bids = repos.blackMarket.bidsFor(day, lotId);
  // A slot id that names nothing on that day's shelf cannot be sold to anybody, and leaving it due
  // would settle it again on every read for ever. It goes down as a lot nobody took.
  const { winner, ranked } =
    slot && spec
      ? awardBlackLot(repos, { day, cityId, slot, spec, bids, now, closedAt, zone })
      : { winner: null, ranked: [] };

  repos.blackMarket.recordResult({
    day,
    lotId,
    slotIndex,
    goodId: slot?.goodId ?? lotId,
    winnerUserId: winner?.userId ?? null,
    price: winner?.price ?? null,
    settledAt: now.toISOString(),
  });
  // The turnover counter, which is what the shelf's derivation reads: a slot that was cleared shows
  // the next thing in its sequence rather than the crate that has gone.
  if (winner) repos.blackMarket.bumpGeneration(day, cityId, slotIndex);
  tellTheFence(repos, { name: spec?.name ?? 'What he had', lotId, bids, ranked, winner, closedAt });
}

/**
 * Walks the ranking and hands the crate to the first crew that can have it.
 *
 * Four things can move between a bid and the close and all four are checked again here: the crew's
 * infamy, its rank, its allowance for the day, and the reserve itself, which is weighted by a city
 * average that drifts as the street levels up. Anybody the check turns away passes to the crew
 * behind them rather than voiding the lot.
 */
function awardBlackLot(
  repos: Repositories,
  lot: {
    day: string;
    /** Whose back room, read back off the lot id. The reserve is that city's number. */
    cityId: string;
    slot: BlackMarketSlot;
    spec: BlackMarketGoodSpec;
    bids: readonly BlackBid[];
    now: Date;
    closedAt: Date;
    zone: string;
  },
): BlackLotAward {
  const { day, cityId, slot, spec, bids, now, closedAt } = lot;
  // Read at the close, not at the bid: the fence asks what this city's street is worth tonight. It
  // moves slowly (a weighted average over the crews with a stake), so a bid that cleared the floor
  // this morning is still above it at midnight in any city that is not being reseeded under the game.
  const reserve = blackLotReserve(spec, cityLevelFor(repos, cityId));
  // The room is in the coin as well as in the reserve: a lot is one city's slot on one night, and
  // that is what the tie-break has to be a function of.
  const ranked = rankLotBids(bids, reserve, blackLotSeed(day, slot.index, cityId));

  for (const entry of ranked) {
    const bid = bids.find((row) => row.userId === entry.userId);
    const base = bid ? repos.bases.findById(bid.baseId) : undefined;
    if (!base) continue;
    // §D7: a crew whose name has slipped since it bid is not handed the good stock either.
    if (base.economy.notoriety < (spec.minNotoriety ?? 0)) continue;
    // A crew that came by the same plans since it bid gets nothing from a second copy.
    if (alreadyKnown(spec, base.inventory)) continue;
    // The allowance. Counted off the rows written by this day's earlier closes, so a crew leading
    // every slot walks away with one crate and the rest of the city takes the other four.
    if (repos.blackMarket.takenOn(base.id, day) >= blackMarketTakesPerDay(base.level)) continue;

    const charge = discountedInfamy(
      entry.amount,
      standingEffectsFor(repos, base).blackMarketDiscountPercent,
    );
    const left = spendInfamy(base.economy.infamy, charge);
    if (left === null) continue;

    handOver(repos, {
      base,
      spec,
      day,
      slotIndex: slot.index,
      infamyLeft: left,
      charge,
      now,
      closedAt,
    });
    return { winner: { userId: entry.userId, price: entry.amount }, ranked };
  }
  return { winner: null, ranked };
}

/**
 * The crate changing hands: the ledger, the inventory or the stash, the receipt, the feats, the bell.
 *
 * A boost goes to the stash and waits for a fight. Everything else lands in the inventory, which is
 * where the workshop, the lab and the build queue already look for parts and blueprints: a back
 * room with its own parallel inventory would be a second place to check for the same crate.
 */
function handOver(
  repos: Repositories,
  won: {
    base: Base;
    spec: BlackMarketGoodSpec;
    day: string;
    slotIndex: number;
    infamyLeft: number;
    /** What actually left the wallet, not the catalogue's figure: the receipt records this. */
    charge: number;
    now: Date;
    closedAt: Date;
  },
): void {
  const { base, spec, day, slotIndex, infamyLeft, charge, now, closedAt } = won;
  const paid: Base = {
    ...base,
    economy: { ...base.economy, infamy: infamyLeft },
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
    infamySpent: charge,
    takenAt: now.toISOString(),
  });
  // The audit row the take route used to write. It belongs at the close now, because the close is
  // where the crate actually changes hands; a bid is a position and has its own row.
  repos.history.record({
    actorId: base.ownerId,
    baseId: paid.id,
    kind: 'blackmarket.taken',
    payload: { goodId: spec.id, slotIndex, infamySpent: charge },
  });

  // Feats: the crate itself, and any pages that came off the shelf with it. The pages ladder counts
  // where a page is *found*, and a fence is one of the three places that happens.
  tallyContrabandTaken(repos, paid.id);
  tallyPagesIn(repos, paid.id, spec.grants ?? {});

  // §F2: the fence sells named pages, so a close can be the moment a document moves a square
  // closer. Rung off the diff rather than off `spec.grants`, so a shelf entry that starts handing
  // over two of something is covered without a second rule here.
  tellPagesFound(repos, {
    userId: base.ownerId,
    before: base.inventory,
    after: paid.inventory,
    source: { kind: 'blackmarket' },
    at: closedAt,
  });
}

/** Who won, and everybody who did not. The barrow's bells, pointed at the other door. */
function tellTheFence(
  repos: Repositories,
  lot: {
    name: string;
    lotId: string;
    bids: readonly BlackBid[];
    ranked: readonly { userId: string }[];
    winner: BlackLotWinner | null;
    closedAt: Date;
  },
): void {
  const { name, lotId, bids, ranked, winner, closedAt } = lot;
  if (winner) {
    notify(repos, {
      userId: winner.userId,
      kind: 'market_won',
      title: `The fence let you have ${name} for ${winner.price} infamy`,
      link: '/game/market/black',
      subjectId: lotId,
      at: closedAt,
    });
  }

  const winnerName = winner
    ? (repos.users.findById(winner.userId)?.username ?? 'another crew')
    : '';
  for (const bid of bids) {
    if (bid.userId === winner?.userId) continue;
    notify(repos, {
      userId: bid.userId,
      kind: 'market_outbid',
      title: missedLotTitle({
        name,
        passed: outcomeAgainst(ranked, winner?.userId ?? null, bid.userId) === 'passed',
        winner: winner ? { name: winnerName, price: `${winner.price} infamy` } : null,
        nobody: 'went to nobody',
      }),
      link: '/game/market/black',
      subjectId: lotId,
      at: closedAt,
    });
  }
}
