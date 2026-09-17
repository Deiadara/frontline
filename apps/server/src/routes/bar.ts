import {
  IncreasePayrollRequestSchema,
  PlaceBidRequestSchema,
  ReleaseOfficerRequestSchema,
  SealBidRequestSchema,
  auctionWindow,
  maxOpenAuctionsFor,
  payrollStepCost,
  type BarResponse,
  type BidResponse,
  type Base,
  type IncreasePayrollResponse,
  type ReleaseOfficerResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import {
  latestResultsFor,
  placeBid,
  projectAuction,
  sealBid,
  settleBarAuctions,
  type BidRefusal,
  type BidRequest,
  type BidResult,
} from '../bar/auction.js';
import {
  bidCeilingFor,
  factionInfamyOf,
  ledgerFor,
  recruitSlotsFor,
  releaseOfficer,
} from '../bar/hire.js';
import { projectOfficer, projectRecruit } from '../bar/project.js';
import { rosterFaces } from '../crew/faces.js';
import { barSeatsFor, barDay, barRoster, findBarRecruit } from '../bar/roster.js';
import { calibreOf, cityAsked, citiesFor } from '../city/stakes.js';
import { seatedRoles } from '../crew/roster.js';
import { crewEffectsFor } from '../crew/standing.js';
import type { BarBid } from '../db/repos/bar.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { takeLevelUp } from '../progression/award.js';

/**
 * The Bar (GDD §H, §H7a).
 *
 * The roster is never read from the database: §H2a makes it a pure function of the game date, so
 * every request recomputes it and two accounts asking on the same day are served the same people.
 * What is stored is what the players did: the bids on the table, the results of yesterday's close,
 * and the officers somebody won (§H7, in W2's payroll book).
 */

/** A player recruits into their one base or into nowhere. */
function requireOwnBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

/**
 * Settle everything the Bar reads off before reading it: last night's tables, then the district.
 *
 * The close is first and it is not only the read's business. A player who opens the Bar at ten past
 * midnight is the one who runs it if the world clock has not got there first, and every route here
 * reads something the close moves: the roster it just filled a chair on, the book it just committed
 * a wage to, the tables a bid is counted against. `POST /bar/bid` and `POST /bar/seal` used to skip
 * it, so a crew that won its last chair overnight could still be offered a table the close would
 * then refuse them at. Read *after* it, because signing writes to this crew.
 */
function settledBase(app: FastifyInstance, ownerId: string, now: Date): Base {
  settleBarAuctions(app.repos, now);
  return settleBase(app.repos, requireOwnBase(app, ownerId), now).base;
}

/**
 * Who has bid, by name.
 *
 * One lookup per distinct account at the tables on screen, which is at most a handful: everybody
 * in the city can bid, but only the crews at these eight or twelve tables are on this payload.
 */
function usernamesFor(app: FastifyInstance, bids: readonly BarBid[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const bid of bids) {
    if (names.has(bid.userId)) continue;
    names.set(bid.userId, app.repos.users.findById(bid.userId)?.username ?? 'Somebody');
  }
  return names;
}

/**
 * Every refusal is a 409: the request was well-formed and the person exists, the table just will
 * not take that bid. The §H3 refusals share a code because the roster read already says *which*
 * door is shut, in `assessment.blockers`.
 *
 * The messages carry the numbers a player needs in order to fix the bid, which is why `too_low`
 * is a function rather than a string: "somebody is at 40" and "beat it by at least 42" are the
 * whole of what the screen has to say, and a client that had to derive the second one from a
 * stale read would print a number the server would refuse.
 */
const BID_ERRORS: Record<BidRefusal, { code: ErrorCode; message: (minimum: number) => string }> = {
  closed: {
    code: 'BID_REFUSED',
    message: () => 'That table closed at midnight. Tonight is a new room',
  },
  sealed: {
    code: 'BID_REFUSED',
    message: () => 'The table is sealed. Lock a final value instead',
  },
  not_sealed: {
    code: 'BID_REFUSED',
    message: () => 'Nothing is sealed yet. Bid in the open while you can',
  },
  not_interested: {
    code: 'RECRUIT_UNAVAILABLE',
    message: () => 'They will not work for a crew like yours at any price',
  },
  already_hired: { code: 'RECRUIT_UNAVAILABLE', message: () => 'They already work for you' },
  no_slots: { code: 'NO_RECRUIT_SLOTS', message: () => 'You have no room for another recruit' },
  too_many_auctions: {
    code: 'TOO_MANY_AUCTIONS',
    // Not "at two tables": a level-40 crew may sit at three, and the count the screen prints is
    // `auctionsAllowed` on every read rather than a number baked into a refusal.
    message: () => 'You are already at every table you can hold. Let one close first',
  },
  outbid_yourself: {
    code: 'BID_REFUSED',
    message: () => 'You are already the highest bid. Save your caps',
  },
  already_sealed: {
    code: 'BID_REFUSED',
    message: () => 'You have locked your final value. That is your answer',
  },
  too_low: {
    code: 'BID_REFUSED',
    message: (minimum) => `Not enough. It takes ${minimum} a week to lead this table`,
  },
  no_payroll: {
    code: 'NO_PAYROLL',
    message: () => 'Your payroll will not stretch that far. Raise it at the Nexus',
  },
};

export function registerBarRoutes(app: FastifyInstance): void {
  /**
   * Resolves the person a bid names on today's roster, or 404s.
   *
   * The room is the same all day now, so there is one way to land here: an id from yesterday, in a
   * tab left open across midnight. The answer is the same as it always was.
   */
  function recruitOnTheRoster(base: Base, day: string, recruitId: string) {
    const seats = barSeatsFor(crewEffectsFor(app.repos, base).recruitPoolPercent);
    const recruit = findBarRecruit(day, recruitId, seats, app.repos.bases.averageLevel());
    if (!recruit) throw new AppError('NOT_FOUND', 'They are not at the Bar today');
    return recruit;
  }

  /** Both bid routes answer with the table as it now stands, so the screen never guesses. */
  function bidResponse(base: Base, userId: string, recruitId: string, now: Date): BidResponse {
    const window = auctionWindow(now);
    const recruit = recruitOnTheRoster(base, window.day, recruitId);
    const bids = app.repos.bar.bidsFor(window.day, recruitId);
    return {
      auction: projectAuction({
        reader: userId,
        window,
        now,
        recruit,
        bids,
        usernames: usernamesFor(app, bids),
      }),
      auctionsUsed: app.repos.bar.bidsBy(userId, window.day).length,
      auctionsAllowed: maxOpenAuctionsFor(base.level),
    };
  }

  function bid(
    request: { currentUser: { id: string }; body: unknown },
    place: (repos: typeof app.repos, input: BidRequest) => BidResult,
    schema: typeof PlaceBidRequestSchema,
  ): BidResponse {
    const { recruitId, amount } = parseBody(schema, request.body);
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);
    const recruit = recruitOnTheRoster(base, barDay(now), recruitId);

    const result = app.db.transaction(() =>
      place(app.repos, {
        base,
        userId: request.currentUser.id,
        recruit,
        amount,
        now,
        admin: app.config.admin,
      }),
    )();
    if (result.kind === 'refused') {
      const { code, message } = BID_ERRORS[result.reason];
      throw new AppError(code, message(result.minimum));
    }
    return bidResponse(base, request.currentUser.id, recruitId, now);
  }

  app.get('/bar', { preHandler: app.authenticate }, (request): BarResponse => {
    const now = new Date();
    const asked = (request.query as { city?: string } | undefined)?.city;
    // Last night's tables settle inside this, so the officer a crew won overnight is on the books
    // by the time this read draws them.
    const base = settledBase(app, request.currentUser.id, now);
    /*
     * §I1/§I2: what the two settles above just banked.
     *
     * `BarResponse.levelUp` has always been on the wire and the screen has always latched it, and
     * nothing ever filled it in: signing somebody pays XP and the close runs here, so this read is
     * often the only one that knows a level was crossed. `takeLevelUp` drains the durable marker
     * (migration 0083), so it is announced exactly once whichever door banked it.
     */
    const levelUp = takeLevelUp(app.repos, base.id);
    /*
     * Which city's room this is (maintainer, 2026-09-17).
     *
     * A bar belongs to a city and a crew may drink in any city they hold ground in, so a read that
     * names one is checked against the map before it is answered. A name they hold nothing in is
     * refused rather than quietly answered with their own room: a player who bookmarked a city they
     * have since been thrown out of should be told, not shown the wrong bar and left to wonder why
     * the faces changed.
     */
    const cityId = cityAsked(app.repos, base, asked);
    if (cityId === null) {
      throw new AppError('CITY_SHUT', 'You hold no ground in that city. Take a place in it first.');
    }
    const window = auctionWindow(now);
    const day = window.day;
    // §F2: Charisma and Diplomacy widen the room. Word gets around about who is hiring.
    const seats = barSeatsFor(crewEffectsFor(app.repos, base).recruitPoolPercent);
    /*
     * §H2: the room scales with the city, weighted by who has a stake in it.
     *
     * It was the flat average level of every base in the world, which stopped being the right
     * number the day a crew could drink in a city they do not live in: somebody holding half of
     * Ashfall had exactly as much say over its room as somebody who has never been. `calibreOf`
     * weights a resident at one and a visitor at the share of ten locations they hold, and counts
     * the notoriety ladder alongside the district level. See `city/access.ts`.
     */
    const roster = barRoster(day, seats, calibreOf(app.repos, cityId), cityId);
    // One face each, free of every crew's in the city: the face the contract will keep.
    const faces = rosterFaces(
      app.repos,
      roster.map((recruit) => recruit.id),
    );
    // §J8: read once for the room rather than once per recruit. Every standout seat's faction door
    // asks the same question of the same badge.
    const factionInfamy = factionInfamyOf(app.repos, base);
    const bids = app.repos.bar.bidsOn(day);
    const usernames = usernamesFor(app, bids);
    // Read once: the book and the discount feed the ledger, the bid ceiling and the payroll gate.
    const effects = crewEffectsFor(app.repos, base);
    const ledger = ledgerFor(base, effects.payrollStepDiscountPercent);

    return {
      day,
      serverNow: now.toISOString(),
      recruits: roster.map((recruit) =>
        projectRecruit(base, recruit, faces.get(recruit.id), factionInfamy),
      ),
      officers: base.commanders.map((officer) => projectOfficer(base, officer)),
      slotsUsed: base.commanders.length,
      slotsTotal: recruitSlotsFor(app.repos, base),
      infamy: base.economy.infamy,
      notoriety: base.economy.notoriety,
      level: base.level,
      caps: base.resources.caps,
      payroll: ledger,
      // Chairs that are actually taken. Somebody on the bench fills none of them, which is what
      // makes the bench worth having: they are signed and every seat is still open to them.
      filledRoles: seatedRoles(base.commanders),
      // In roster order, so the card and its table are the same index on the screen.
      auctions: roster.map((recruit) =>
        projectAuction({
          reader: request.currentUser.id,
          window,
          now,
          recruit,
          bids: bids.filter((entry) => entry.recruitId === recruit.id),
          usernames,
        }),
      ),
      auctionsUsed: app.repos.bar.bidsBy(request.currentUser.id, day).length,
      auctionsAllowed: maxOpenAuctionsFor(base.level),
      // The most this crew can put on a table: what the book holds after its own negotiators.
      bidCeiling: bidCeilingFor(ledger.available, effects.wageDiscountPercent),
      // Only the tables this crew sat at, from the last night it sat at any. A results panel that
      // carried every close in the city would be a leaderboard nobody asked for.
      results: latestResultsFor(app.repos, request.currentUser.id, day),
      levelUp,
      cityId,
      cities: citiesFor(app.repos, base),
    };
  });

  /** §H7a: a public bid. Live, visible to the whole city, and it has to beat the leader. */
  app.post('/bar/bid', { preHandler: app.authenticate }, (request): BidResponse => {
    return bid(request, placeBid, PlaceBidRequestSchema);
  });

  /** §H7a: the one sealed final value, in the last half hour. No changes after it lands. */
  app.post('/bar/seal', { preHandler: app.authenticate }, (request): BidResponse => {
    return bid(request, sealBid, SealBidRequestSchema);
  });

  /**
   * §H7: let an officer go.
   *
   * Their slice of the book is freed immediately and ten weeks of it is taken in caps on the
   * spot. Deliberately not reversible and deliberately expensive: the book is a standing promise,
   * and a crew that could rotate its officers for free would never have to live with one.
   */
  app.post('/bar/release', { preHandler: app.authenticate }, (request): ReleaseOfficerResponse => {
    const { officerId } = parseBody(ReleaseOfficerRequestSchema, request.body);
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);

    const result = app.db.transaction(() =>
      releaseOfficer(app.repos, base, officerId, app.config.admin),
    )();
    if (result.kind === 'refused') {
      if (result.reason === 'not_on_the_books') {
        throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
      }
      throw new AppError('INSUFFICIENT_CAPS', 'You cannot cover what letting them go would cost');
    }

    return {
      officerId,
      fee: result.fee,
      resources: result.base.resources,
      payroll: result.payroll,
    };
  });

  /**
   * §H7: buy one more step of standing payroll.
   *
   * The Nexus screen's `Increase Payroll`. A fixed step at a price that climbs by a flat amount
   * with every step already bought, up to `PAYROLL_STEPS_MAX` rungs and then no further:
   * `payrollStepCost` owns all of that and this route only moves the caps.
   */
  app.post('/bar/payroll', { preHandler: app.authenticate }, (request): IncreasePayrollResponse => {
    const { fromSteps } = parseBody(IncreasePayrollRequestSchema, request.body ?? {});
    const now = new Date();
    const base = settledBase(app, request.currentUser.id, now);
    // Same guard as the notoriety ladder: the step the screen showed has to be the step the row
    // is on, or a second press buys a second step nobody asked for.
    if (fromSteps !== undefined && fromSteps !== base.economy.payroll.purchasedSteps) {
      throw new AppError(
        'STALE_STATE',
        'The book has already widened. Read it again before buying.',
      );
    }

    // §B7: officers who make widening the book cheaper (`payrollStepDiscountPercent`).
    const cost = payrollStepCost(
      base.economy.payroll.purchasedSteps,
      crewEffectsFor(app.repos, base).payrollStepDiscountPercent,
    );
    // Before the stockpile, so a crew that could pay ten times over is told the real reason rather
    // than being handed an affordability refusal it cannot act on. Not waived by admin mode: there
    // is no step to sell, so there is no price for admin to waive.
    if (cost === null) {
      throw new AppError('PAYROLL_AT_MAX', 'The book is as wide as it goes. There is no step left');
    }
    if (cost > base.resources.caps && !app.config.admin) {
      throw new AppError('INSUFFICIENT_CAPS', 'You cannot cover that');
    }

    const raised = app.db.transaction(() => {
      const resources = {
        ...base.resources,
        caps: base.resources.caps - (app.config.admin ? 0 : cost),
      };
      const economy = {
        ...base.economy,
        payroll: {
          ...base.economy.payroll,
          purchasedSteps: base.economy.payroll.purchasedSteps + 1,
        },
      };
      app.repos.bases.updateResources(base.id, resources);
      app.repos.bases.updateEconomy(base.id, economy);
      return { ...base, resources, economy };
    })();

    return {
      spent: cost,
      resources: raised.resources,
      payroll: ledgerFor(raised, crewEffectsFor(app.repos, raised).payrollStepDiscountPercent),
    };
  });
}
